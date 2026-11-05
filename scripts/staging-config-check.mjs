import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateStaging } from "./check-staging-deployment.mjs";
const workflow = yaml.load(readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8"));
const values = { STAGING_IMAGE: `ghcr.io/imnoname25/notebook@sha256:${"1".repeat(64)}`, STAGING_DB_PASSWORD: "2".repeat(64), STAGING_SETTINGS_KEY: "3".repeat(64), STAGING_BIND_IP: "127.0.0.1", STAGING_ORIGIN: "http://notebook-staging.home.arpa:3101" };
const compose = yaml.load(readFileSync(new URL("../docker-compose.staging.yml", import.meta.url), "utf8").replace(/\$\{([A-Z_]+)(?::[-?][^}]*)?\}/g, (_, key) => { assert.ok(key in values);return values[key]; }));
assert.deepEqual(compose.services.notebook.ports, ["127.0.0.1:3101:3000"]);
compose.services.notebook.ports = [{ host_ip: "127.0.0.1", published: "3101", target: 3000 }];
test("staging Compose is isolated and pinned", () => assert.equal(validateStaging(compose), true));
for (const [name, change] of [
  ["production database", c => { c.services.notebook.environment.DATABASE_URL = "postgresql://notebook:unused@notebook-postgres:5432/notebook"; }],
  ["production mount", c => { c.services.notebook.volumes[0].source = "/mnt/user/appdata/notebook/uploads"; }],
  ["production network", c => { c.services.notebook.networks = ["notebook-net"]; }],
  ["external network", c => { c.networks.staging.external = true; }],
  ["database port", c => { c.services.postgres.ports = ["5432:5432"]; }],
  ["public bind", c => { c.services.notebook.ports[0].host_ip = "0.0.0.0"; }],
  ["mutable image", c => { c.services.notebook.image = "ghcr.io/imnoname25/notebook:main"; }],
  ["shared cookie hostname", c => { c.services.notebook.environment.APP_ORIGIN = "http://192.168.1.10:3101"; }],
  ["extra mount", c => { c.services.notebook.volumes.push({ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }); }],
]) test(`rejects ${name}`, () => { const config = structuredClone(compose);change(config);assert.throws(() => validateStaging(config)); });
test("staging publication cannot write production tags", () => {
  assert.deepEqual(workflow.on.push.branches, ["main", "staging/studio-4.4-e"]);
  assert.equal(workflow.jobs.publish.if, "github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))");
  const job = workflow.jobs["publish-staging"];
  assert.equal(job.if, "github.event_name != 'pull_request' && github.ref == 'refs/heads/staging/studio-4.4-e'");
  assert.equal(job.needs, "smoke");assert.equal(workflow.jobs.smoke.needs, "validate");
  const commands = job.steps.map(s => s.run ?? "").join("\n");
  assert.ok(commands.includes("docker load") && commands.includes("PRISMA_SCHEMA_ENGINE_BINARY"));
  assert.ok(commands.includes('for tag in staging-4.4-e "staging-4.4-e-$GITHUB_SHA"'));
  assert.ok(!/docker (?:tag|push)[^\n]*(?::main|:edge|:latest)/.test(commands));
  assert.ok(commands.includes("org.opencontainers.image.revision") && commands.includes("linux/amd64"));
});

test("CLI failures do not disclose config or secret operands", () => {
  const config = structuredClone(compose);config.services.postgres.environment.POSTGRES_PASSWORD = "9".repeat(64);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-staging-deployment.mjs", import.meta.url))], { input: JSON.stringify(config), encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes("9".repeat(64)) && !result.stderr.includes("9".repeat(64)));
  assert.match(result.stderr, /No values logged/);
});
