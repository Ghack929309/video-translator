/**
 * Worker entrypoint — runs as a separate Fly.io process.
 * Polls Supabase Queue (pgmq) for translation:process jobs.
 *
 * Run with: npx tsx worker.ts
 */
import {
  createPgPool,
  ensureQueue,
  QUEUE_NAME,
} from "~/services/worker.server";
import { pipeline } from "~/services/pipeline.server";
import { db } from "~/services/db.server";
import { runpodApi } from "~/services/runpod-api.server";
import { env } from "~/utils/env.server";

let running = true;

// Visibility timeout in seconds — how long a message is hidden from other
// consumers while being processed. Set high enough for the pipeline to finish.
const VISIBILITY_TIMEOUT = 3900; // 65 minutes (must exceed JOB_TIMEOUT_MS)

function startWatchdog() {
  console.log("[watchdog] Starting 10-minute idle checks...");
  setInterval(async () => {
    try {
      const staleLimit = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const stalledJobs = await db.translation.findMany({
        where: {
          status: "PROCESSING",
          updatedAt: { lt: staleLimit },
        },
      });

      if (stalledJobs.length > 0) {
        console.warn(
          `[watchdog] Found ${stalledJobs.length} stalled jobs. Failing them and halting Pods.`,
        );
        for (const job of stalledJobs) {
          await db.translation.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              errorMessage: "Unrecoverable Execution Timeout (1hr)",
            },
          });
        }

        if (env.RUNPOD_POD_ID) {
          console.warn(`[watchdog] Halting On-Demand Pod due to stalled jobs.`);
          await runpodApi
            .stopPod(env.RUNPOD_POD_ID)
            .catch((e: any) => console.error("[watchdog] Failed to stop pod:", e));
        }
      }
    } catch (e) {
      // Swallow connection errors — watchdog is best-effort, will retry next interval
      console.error("[watchdog] Error (will retry next interval):", e instanceof Error ? e.message : e);
    }
  }, 10 * 60 * 1000); // 10 minutes
}

/**
 * Create a fresh pool and verify the connection works.
 * Retries with exponential backoff on failure.
 */
async function createPoolWithRetry(maxRetries = 10): Promise<ReturnType<typeof createPgPool>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = createPgPool();
      pool.on("error", (err: Error) => {
        console.error("[worker] Idle pool connection error (discarding):", err.message);
      });
      // Verify the connection actually works
      await pool.query("SELECT 1");
      await ensureQueue(pool);
      return pool;
    } catch (err) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30_000);
      console.error(
        `[worker] Connection attempt ${attempt}/${maxRetries} failed: ${err instanceof Error ? err.message : err}. Retrying in ${delay / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("[worker] Failed to connect after max retries");
}

/**
 * Check if an error is a connection/network failure that warrants pool recreation.
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = (err as any).code;
  return (
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    msg.includes("connection terminated") ||
    msg.includes("server has closed the connection") ||
    msg.includes("connection refused") ||
    msg.includes("timeout expired")
  );
}

async function main() {
  console.log("[worker] Starting...");

  startWatchdog();

  let pool = await createPoolWithRetry();

  console.log(`[worker] Listening for ${QUEUE_NAME} messages...`);

  while (running) {
    try {
      // read_with_poll: blocks up to max_poll_seconds waiting for a message
      const result = await pool.query(
        "SELECT * FROM pgmq.read_with_poll($1, $2, $3, $4, $5)",
        [QUEUE_NAME, VISIBILITY_TIMEOUT, 1, 5, 250],
        // queue, vt, qty, max_poll_seconds, poll_interval_ms
      );

      if (result.rows.length === 0) continue;

      const row = result.rows[0];
      const msgId = row.msg_id;
      const payload = row.message as { translationId: string };

      console.log(
        `[worker] Processing msg ${msgId} — translation ${payload.translationId}`,
      );

      try {
        await pipeline.run(payload.translationId);

        // Archive the message on success (moves to archive table)
        await pool.query("SELECT pgmq.archive($1, $2::bigint)", [
          QUEUE_NAME,
          msgId,
        ]);
        console.log(`[worker] Archived msg ${msgId}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] Pipeline failed for msg ${msgId}:`, err);

        // Archive stale messages that reference deleted records
        if (errMsg.includes("P2025") || errMsg.includes("not found")) {
          await pool.query("SELECT pgmq.archive($1, $2::bigint)", [
            QUEUE_NAME,
            msgId,
          ]);
          console.log(`[worker] Archived stale msg ${msgId} (record deleted)`);
        }
        // Otherwise message becomes visible again after VISIBILITY_TIMEOUT
      }
    } catch (err) {
      if (!running) break;
      console.error("[worker] Poll error:", err instanceof Error ? err.message : err);

      if (isConnectionError(err)) {
        console.log("[worker] Connection lost. Recreating pool...");
        try { await pool.end().catch(() => {}); } catch {}
        try {
          pool = await createPoolWithRetry();
          console.log("[worker] Pool recreated successfully.");
        } catch (reconnectErr) {
          console.error("[worker] Failed to reconnect:", reconnectErr);
          // Continue loop — will try again next iteration
          await new Promise((r) => setTimeout(r, 10_000));
        }
      } else {
        // Non-connection error — brief backoff
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  await pool.end();
  console.log("[worker] Stopped.");
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[worker] ${signal} received. Finishing current job...`);
  running = false;
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
