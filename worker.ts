/**
 * Worker entrypoint — runs as a separate Fly.io process.
 * Starts pg-boss and listens for translation:process jobs.
 *
 * This file will be fully implemented in Phase 4.
 */

console.log("Worker process starting...");
console.log("Worker is a placeholder — implement in Phase 4.");

// Graceful shutdown handler
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  process.exit(0);
});
