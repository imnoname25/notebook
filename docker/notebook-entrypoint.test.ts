import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Contract tests with fake bootstrap tools, NOT Docker/PostgreSQL integration.
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function startup(mode: string, deadline = "5", missingEngine = false) {
  const root = mkdtempSync(join(tmpdir(), "notebook-startup-unit-"));roots.push(root);
  const app = join(root, "app"), bin = join(root, "bin");
  for (const p of [bin, join(app, "docker"), join(app, "prisma"), join(app, "node_modules/.bin")]) mkdirSync(p, { recursive: true });
  const script = (p: string, content: string) => writeFileSync(p, `#!/bin/sh\n${content}\n`, { mode: 0o755 });
  script(join(bin, "id"), "echo 0");
  for (const name of ["chown", "chmod"]) script(join(bin, name), "exit 0");
  script(join(bin, "gosu"), 'shift; exec "$@"');
  script(join(bin, "node"), mode === "preflight-fail" ? "exit 19" : "echo 'Database available (test double)'");
  if (!missingEngine) script(join(app, "prisma/schema-engine"), "exit 0");
  script(join(app, "node_modules/.bin/prisma"), mode === "hang" ? "sleep 60" : mode === "fail" ? "echo 'Synthetic migration error' >&2; exit 23" : "echo 'Synthetic migrations applied'");
  const entrypoint = join(root, "entrypoint.sh");
  writeFileSync(entrypoint, readFileSync(resolve("docker/notebook-entrypoint.sh"), "utf8").replace("APP_DIR=/app", 'APP_DIR="$TEST_APP_DIR"'));
  const pathSetup = process.platform === "win32" ? 'PATH="$(cygpath -u "$TEST_BIN"):$PATH";' : 'PATH="$TEST_BIN:$PATH";';
  const result = spawnSync(bash, ["-c", `${pathSetup} export PATH; exec sh "$TEST_ENTRYPOINT" sh -c "echo SERVER_STARTED"`], {
    encoding: "utf8", timeout: 20_000,
    env: { ...process.env, TEST_BIN: bin.replaceAll("\\", "/"), TEST_ENTRYPOINT: entrypoint.replaceAll("\\", "/"), TEST_APP_DIR: app.replaceAll("\\", "/"), UPLOAD_DIR: join(root, "uploads").replaceAll("\\", "/"), BACKUP_DIR: join(root, "backups").replaceAll("\\", "/"), PRISMA_SCHEMA_ENGINE_BINARY: join(app, "prisma/schema-engine").replaceAll("\\", "/"), MIGRATION_TIMEOUT_SECONDS: deadline, PUID: "99", PGID: "100", FIX_PERMISSIONS: "0" },
  });
  return { ...result, output: result.stdout + result.stderr };
}
describe.skipIf(!existsSync(bash))("entrypoint fail-closed migration contract", () => {
  it("starts only after successful migrations", () => { const r = startup("ok");expect(r.status).toBe(0);expect(r.output.indexOf("Migrations complete")).toBeLessThan(r.output.indexOf("SERVER_STARTED")); });
  it("preserves migration failure status and never starts server", () => { const r = startup("fail");expect(r.status).toBe(23);expect(r.output).toContain("migrations failed");expect(r.output).not.toContain("SERVER_STARTED"); });
  it("does not invoke migration/server after failed preflight", () => { const r = startup("preflight-fail");expect(r.status).toBe(19);expect(r.output).not.toContain("Synthetic migrations");expect(r.output).not.toContain("SERVER_STARTED"); });
  it("rejects a missing engine before attempting CLI download", () => { const r = startup("ok", "5", true);expect(r.status).toBe(1);expect(r.output).toContain("Schema Engine is missing");expect(r.output).not.toContain("SERVER_STARTED"); });
  it.each(["0", "4", "901", "forever", "99999999999999999999"])("rejects invalid deadline %s", value => { const r = startup("ok", value);expect(r.status).toBe(1);expect(r.output).toContain("MIGRATION_TIMEOUT_SECONDS");expect(r.output).not.toContain("SERVER_STARTED"); });
  it("terminates a hung CLI within a bounded deadline", () => { const r = startup("hang");expect(r.error).toBeUndefined();expect(r.status).toBe(124);expect(r.output).toContain("exceeded 5s");expect(r.output).not.toContain("SERVER_STARTED"); }, 25_000);
});
