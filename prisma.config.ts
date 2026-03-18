import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // DATABASE_URL points to the pooler (port 6543) for the web server at runtime.
    // For migrations, run: DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate dev
    url: env("DATABASE_URL"),
  },
});
