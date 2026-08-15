import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Generation does not require a live database; runtime/deploy still use DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgresql://notebook:notebook@localhost:5432/notebook",
  },
});
