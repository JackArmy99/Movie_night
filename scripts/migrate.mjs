// Runs database migrations during a deploy — but only once a database is
// attached. Without this, the very first Vercel deploy (before the Neon
// database is added) would fail and look broken.
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] No DATABASE_URL yet — skipping. Add the Neon database, then redeploy.");
  process.exit(0);
}
if (!process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env, shell: true });
