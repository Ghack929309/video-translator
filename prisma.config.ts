import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use DIRECT_DATABASE_URL (session-mode pooler, port 5432) for migrations.
    // DATABASE_URL (transaction-mode pooler, port 6543) is used at runtime via PrismaPg adapter.
    url: env("DIRECT_DATABASE_URL"),
  },
});
