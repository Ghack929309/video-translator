import pg from "pg";
import { env } from "~/utils/env.server";

export const QUEUE_NAME = "translation_process";

/**
 * Get a direct Postgres client for pgmq operations.
 * Uses DIRECT_DATABASE_URL (port 5432) — not the pooler.
 */
export function createPgClient() {
  return new pg.Client({ connectionString: env.DIRECT_DATABASE_URL });
}

/**
 * Ensure the pgmq extension is enabled and the queue exists.
 * Safe to call multiple times (idempotent).
 */
export async function ensureQueue(client: pg.Client) {
  await client.query("CREATE EXTENSION IF NOT EXISTS pgmq");
  // Only create the queue if it doesn't already exist — pgmq.create() is not
  // idempotent and throws if the queue's sequence is already part of the extension.
  const { rows } = await client.query(
    "SELECT 1 FROM pgmq.meta WHERE queue_name = $1",
    [QUEUE_NAME],
  );
  if (rows.length === 0) {
    await client.query("SELECT pgmq.create($1)", [QUEUE_NAME]);
  }
}

/**
 * Send a translation processing job to the Supabase Queue.
 * Called from the web server when a new translation is created.
 */
export async function enqueueTranslation(translationId: string) {
  const client = createPgClient();
  await client.connect();

  try {
    await ensureQueue(client);
    const result = await client.query(
      "SELECT * FROM pgmq.send($1, $2::jsonb)",
      [QUEUE_NAME, JSON.stringify({ translationId })],
    );
    const msgId = result.rows[0]?.send;
    console.log(
      `[queue] Enqueued msg ${msgId} for translation ${translationId}`,
    );
    return msgId;
  } finally {
    await client.end();
  }
}
