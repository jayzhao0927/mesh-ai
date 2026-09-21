import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Applies migrations to the test database. The test URL is read from the
 * environment, falling back to TEST_DATABASE_URL in .env, so tests never touch
 * the development database.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    const contents = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    const line = contents
      .split("\n")
      .find((l) => l.trim().startsWith("TEST_DATABASE_URL="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  } catch {
    // No .env file: fall through to the error below.
  }
  throw new Error("TEST_DATABASE_URL is not set (env or .env)");
}

execFileSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
});
