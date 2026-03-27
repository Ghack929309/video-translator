/**
 * Worker entrypoint — runs as a separate Fly.io process.
 * Polls Supabase Queue (pgmq) for translation:process jobs.
 *
 * Run with: npx tsx worker.ts
 */
import {
  createPgClient,
  ensureQueue,
  QUEUE_NAME,
} from "~/services/worker.server";
import { pipeline } from "~/services/pipeline.server";

let running = true;

// Visibility timeout in seconds — how long a message is hidden from other
// consumers while being processed. Set high enough for the pipeline to finish.
const VISIBILITY_TIMEOUT = 3900; // 65 minutes (must exceed JOB_TIMEOUT_MS)

async function main() {
  console.log("[worker] Starting...");

  const client = createPgClient();
  await client.connect();
  await ensureQueue(client);

  console.log(`[worker] Listening for ${QUEUE_NAME} messages...`);

  while (running) {
    try {
      // read_with_poll: blocks up to max_poll_seconds waiting for a message
      const result = await client.query(
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
        await client.query("SELECT pgmq.archive($1, $2::bigint)", [
          QUEUE_NAME,
          msgId,
        ]);
        console.log(`[worker] Archived msg ${msgId}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[worker] Pipeline failed for msg ${msgId}:`, err);

        // Archive stale messages that reference deleted records
        if (errMsg.includes("P2025") || errMsg.includes("not found")) {
          await client.query("SELECT pgmq.archive($1, $2::bigint)", [
            QUEUE_NAME,
            msgId,
          ]);
          console.log(`[worker] Archived stale msg ${msgId} (record deleted)`);
        }
        // Otherwise message becomes visible again after VISIBILITY_TIMEOUT
      }
    } catch (err) {
      if (!running) break;
      console.error("[worker] Poll error:", err);
      // Back off on connection errors
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  await client.end();
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
