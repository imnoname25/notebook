import pg from "pg";

const { Client } = pg;

function fail(message) {
  console.error(`Startup validation failed: ${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function parseUrl(name, value, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) fail(`${name} uses an unsupported protocol`);
  return parsed;
}

console.log("Validating runtime configuration...");

const databaseUrl = required("DATABASE_URL");
const parsedDatabaseUrl = parseUrl("DATABASE_URL", databaseUrl, ["postgres:", "postgresql:"]);
if (!parsedDatabaseUrl.hostname || !parsedDatabaseUrl.username || parsedDatabaseUrl.pathname === "/") {
  fail("DATABASE_URL must include a host, user and database name");
}

const appOrigin = required("APP_ORIGIN");
const parsedOrigin = parseUrl("APP_ORIGIN", appOrigin, ["http:", "https:"]);
if (parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash || !["", "/"].includes(parsedOrigin.pathname)) {
  fail("APP_ORIGIN must be an origin without credentials, path, query or fragment");
}

const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
if (encryptionKey) {
  const keyBytes = /^[a-f0-9]{64}$/i.test(encryptionKey)
    ? Buffer.from(encryptionKey, "hex")
    : Buffer.from(encryptionKey, "base64");
  if (keyBytes.byteLength !== 32) fail("SETTINGS_ENCRYPTION_KEY must contain exactly 32 bytes in hex or base64");
}

const timeoutSeconds = Number.parseInt(process.env.DATABASE_WAIT_TIMEOUT_SECONDS ?? "90", 10);
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300) {
  fail("DATABASE_WAIT_TIMEOUT_SECONDS must be an integer from 5 to 300");
}

console.log("Runtime configuration valid");
console.log("Waiting for PostgreSQL...");

const retryDelayMs = 2_000;
const maxAttempts = Math.ceil((timeoutSeconds * 1_000) / retryDelayMs);
const deadline = Date.now() + timeoutSeconds * 1_000;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) break;
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: Math.min(5_000, remainingMs),
    application_name: "notebook-startup",
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    console.log("Database available");
    process.exit(0);
  } catch {
    await client.end().catch(() => undefined);
    if (attempt === maxAttempts) break;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`PostgreSQL is not ready yet (attempt ${attempt}/${maxAttempts})`);
    }
    const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
    if (delayMs === 0) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

console.error(`PostgreSQL did not become available within ${timeoutSeconds} seconds`);
process.exit(1);
