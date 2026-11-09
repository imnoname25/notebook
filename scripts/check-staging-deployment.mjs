import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = "/mnt/user/appdata/note-staging";
const keys = value => Array.isArray(value) ? value : Object.keys(value ?? {});
export function validateStaging(config) {
  assert.equal(config.name, "notebook-staging", "Wrong Compose project");
  assert.deepEqual(Object.keys(config.services).sort(), ["notebook", "postgres"], "Unexpected services");
  assert.deepEqual(Object.keys(config.networks), ["staging"], "Unexpected networks");
  assert.equal(config.networks.staging.name, "notebook-staging-net", "Wrong network");
  assert.equal(config.networks.staging.internal, true, "Network must be internal");
  assert.ok(!config.networks.staging.external, "External network forbidden");
  const app = config.services.notebook, db = config.services.postgres;
  assert.equal(app.container_name, "notebook-staging", "Wrong application container");
  assert.equal(db.container_name, "notebook-staging-postgres", "Wrong database container");
  for (const service of [app, db]) {
    assert.deepEqual(keys(service.networks), ["staging"], "Unexpected service network");
    assert.ok(!service.network_mode && !service.privileged && !service.devices && !service.pid && !service.ipc, "Host access forbidden");
    assert.ok(!service.env_file, "Unresolved env_file forbidden");
  }
  assert.equal(db.image, "postgres:17-alpine", "PostgreSQL17 required");
  assert.equal(db.ports?.length ?? 0, 0, "Database must not publish ports");
  assert.equal(app.ports.length, 1, "One application port required");
  const port = app.ports[0];
  assert.equal(Number(port.target), 3000, "Wrong container port");
  assert.equal(String(port.published), "3101", "Wrong staging port");
  const ip = port.host_ip;
  assert.ok(typeof ip === "string" && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(ip), "Bind an explicit private LAN/VPN IPv4 or loopback");
  const mounts = service => service.volumes.map(v => {
    assert.equal(v.type, "bind", "Only explicit staging bind mounts allowed");
    assert.equal(v.bind?.create_host_path, false, "Missing directories must fail closed");
    return [v.source, v.target];
  }).sort();
  assert.deepEqual(mounts(db), [[`${root}/postgres`, "/var/lib/postgresql/data"]], "Wrong database mount");
  assert.deepEqual(mounts(app), [[`${root}/backups`, "/data/backups"], [`${root}/uploads`, "/data/uploads"]], "Wrong application mounts");
  assert.match(app.image, /^ghcr\.io\/imnoname25\/notebook@sha256:[a-f0-9]{64}$/, "Pinned Notebook digest required");
  const env = app.environment;
  const allowed = ["DATABASE_URL", "APP_ORIGIN", "SETTINGS_ENCRYPTION_KEY", "UPLOAD_DIR", "BACKUP_DIR", "NOTEBOOK_CHANNEL", "PUID", "PGID", "UMASK", "DATABASE_WAIT_TIMEOUT_SECONDS", "MIGRATION_TIMEOUT_SECONDS"];
  assert.deepEqual(Object.keys(env).sort(), allowed.sort(), "Unexpected environment keys");
  let url, origin;
  try { url = new URL(env.DATABASE_URL);origin = new URL(env.APP_ORIGIN); } catch { throw new Error("Invalid staging URL (values not logged)"); }
  assert.equal(url.protocol, "postgresql:", "Wrong database protocol");
  assert.equal(url.hostname, "postgres", "Database must be the isolated service");
  assert.equal(url.port, "5432", "Wrong database port");
  assert.equal(url.username, "notebook_staging", "Wrong database role");
  assert.equal(url.pathname, "/notebook_staging", "Wrong database name");
  assert.match(url.password, /^[a-f0-9]{64}$/, "Use an independent random hex database password");
  assert.equal(db.environment.POSTGRES_DB, "notebook_staging", "Wrong database environment");
  assert.equal(db.environment.POSTGRES_USER, "notebook_staging", "Wrong database environment");
  // Do not use assertion equality for secrets: its failure output contains operands.
  assert.ok(db.environment.POSTGRES_PASSWORD === url.password, "Database passwords disagree");
  assert.match(env.SETTINGS_ENCRYPTION_KEY, /^[a-f0-9]{64}$/, "Independent staging settings key required");
  assert.ok(env.SETTINGS_ENCRYPTION_KEY !== url.password, "Generate separate secrets");
  assert.ok(["http:", "https:"].includes(origin.protocol) && origin.hostname.startsWith("notebook-staging.") && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "Use a separate notebook-staging hostname origin");
  assert.equal(env.NOTEBOOK_CHANNEL, "staging", "Wrong channel");
  assert.equal(env.UPLOAD_DIR, "/data/uploads", "Wrong uploads path");
  assert.equal(env.BACKUP_DIR, "/data/backups", "Wrong backups path");
  return true;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    let config;
    try { config = JSON.parse(readFileSync(0, "utf8")); } catch { throw new Error("Invalid Compose JSON (values not logged)"); }
    validateStaging(config);
    console.log("Staging isolation validation passed; configuration values not printed.");
  } catch {
    console.error("Staging isolation validation failed; inspect the staging-only configuration locally. No values logged.");
    process.exitCode = 1;
  }
}
