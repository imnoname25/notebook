import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const entrypoint = readFileSync(resolve(root, "docker/notebook-entrypoint.sh"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(`Docker packaging validation failed: ${message}`);
}

const runtimeScriptCopies = [...dockerfile.matchAll(/^COPY\s+(\S+\.mjs)\s+(\S+)\s*$/gm)];
assert(runtimeScriptCopies.length > 0, "Dockerfile must copy at least one runtime .mjs script");

for (const [, source, destination] of runtimeScriptCopies) {
  const installedPath = destination.startsWith("/")
    ? posix.normalize(destination)
    : posix.resolve("/app", destination);
  const isInApplicationTree = installedPath === "/app" || installedPath.startsWith("/app/");
  assert(isInApplicationTree, `${source} must be copied inside /app, not ${installedPath}`);
}

assert(dockerfile.includes("WORKDIR /app"), "runner must use the application directory as its working directory");
assert(
  dockerfile.includes("COPY --from=production-dependencies /app/node_modules ./node_modules"),
  "production node_modules must be installed in /app for runtime scripts and Prisma",
);
assert(
  dockerfile.includes("COPY docker/preflight.mjs /app/docker/preflight.mjs"),
  "preflight.mjs must be installed at /app/docker/preflight.mjs",
);
assert(
  entrypoint.includes('run_as_notebook node "$APP_DIR/docker/preflight.mjs"'),
  "entrypoint must execute preflight.mjs from the application tree",
);
assert(
  entrypoint.includes('run_as_notebook "$APP_DIR/node_modules/.bin/prisma" migrate deploy'),
  "entrypoint must execute the packaged Prisma CLI from /app/node_modules",
);
assert(!entrypoint.includes("/usr/local/lib/notebook"), "entrypoint references a Node script outside /app");
assert(packageJson.dependencies?.pg, "pg must remain a direct production dependency");
assert(packageJson.dependencies?.prisma, "Prisma CLI must remain a production dependency for migrate deploy");

const requireFromPreflight = createRequire(new URL("../docker/preflight.mjs", import.meta.url));
requireFromPreflight.resolve("pg");
requireFromPreflight.resolve("prisma/package.json");

console.log(`Validated ${runtimeScriptCopies.length} Docker runtime Node script path(s) and production dependency resolution.`);
