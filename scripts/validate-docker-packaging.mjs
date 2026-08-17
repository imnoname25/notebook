import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
const entrypoint = readFileSync(resolve(root, "docker/notebook-entrypoint.sh"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const entrypointLines = entrypoint.split(/\r?\n/).map((line) => line.trim());

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
assert(dockerfile.includes('CMD ["node", "server.js"]'), "the final command must start the standalone Node server");
assert(
  dockerfile.includes("COPY docker/preflight.mjs /app/docker/preflight.mjs"),
  "preflight.mjs must be installed at /app/docker/preflight.mjs",
);
assert(dockerfile.includes("COPY --from=builder /app/scripts ./scripts"), "production image must include recovery scripts under /app/scripts");
assert(dockerfile.includes("COPY --from=builder /app/shared ./shared"), "production image must include shared runtime modules under /app/shared");
assert(dockerfile.includes("chmod 0755 /app/scripts/admin-recovery.mjs"), "admin recovery CLI must be executable in the production image");
const recoveryCli = readFileSync(resolve(root, "scripts/admin-recovery.mjs"), "utf8");
assert(recoveryCli.includes('from "./admin-recovery-service.mjs"'), "CLI must use the shared recovery service");
assert(recoveryCli.includes('from "./admin-recovery-db.mjs"'), "CLI database adapter must stay inside the application script tree");
assert(!recoveryCli.includes("PrismaClient"), "runtime recovery CLI must not import the TypeScript-generated Prisma client directly");
assert(!/--password|process\.env\.[A-Z_]*PASSWORD/.test(recoveryCli), "recovery password must only be accepted through hidden TTY input");
assert(recoveryCli.includes("RESET"), "recovery CLI must require an explicit destructive-action confirmation");
const applicationPassword = readFileSync(resolve(root, "src/lib/auth/password.ts"), "utf8");
const recoveryService = readFileSync(resolve(root, "scripts/admin-recovery-service.mjs"), "utf8");
const sharedPassword = readFileSync(resolve(root, "shared/auth-password.mjs"), "utf8");
assert(applicationPassword.includes('shared/auth-password.mjs'), "application password wrapper must import the shared runtime implementation");
assert(!applicationPassword.includes("scripts/"), "application password code must not depend on /scripts");
assert(recoveryService.includes('../shared/auth-password.mjs'), "recovery service must import the same shared password implementation");
assert(sharedPassword.includes("export const KEY_LENGTH = 64"), "shared password key length must remain 64 bytes");
assert(sharedPassword.includes("export const SALT_BYTES = 16"), "shared password salt must remain 16 bytes");
assert(sharedPassword.includes('return `scrypt:${salt}:${derived.toString("hex")}`'), "stored password hash format must remain unchanged");
const ignoredPaths = dockerignore.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
assert(!ignoredPaths.includes("shared") && !ignoredPaths.includes("shared/**"), "shared runtime modules must be present in the Docker build context");
assert(!ignoredPaths.includes("scripts") && !ignoredPaths.includes("scripts/**"), "recovery scripts must be present in the Docker build context");
assert(dockerfile.indexOf("COPY . .") < dockerfile.indexOf("RUN npm run db:generate && npm run build"), "shared modules must enter the builder before the Next.js build");
assert(
  entrypointLines.includes('node "$APP_DIR/docker/preflight.mjs"'),
  "entrypoint must execute preflight.mjs from the application tree during root bootstrap",
);
assert(
  entrypointLines.includes('"$APP_DIR/node_modules/.bin/prisma" migrate deploy'),
  "entrypoint must execute the packaged Prisma CLI from /app/node_modules during root bootstrap",
);
assert(!entrypoint.includes("/usr/local/lib/notebook"), "entrypoint references a Node script outside /app");
assert(!/chown[^\r\n]*(?:\/app|\$APP_DIR)/.test(entrypoint), "entrypoint must not chown the application tree");
assert(!/chown[^\r\n]*\/app/.test(dockerfile), "Dockerfile must not chown the application tree");
assert(!entrypoint.includes("id -u notebook"), "entrypoint must use numeric PUID and PGID, not a named user");
assert(entrypointLines.includes("set -eu"), "entrypoint must stop when preflight or migrations fail");
assert(
  entrypoint.includes('if [ "$(id -u)" -ne 0 ]'),
  "entrypoint must require root only for storage and migration bootstrap",
);
assert(
  entrypointLines.includes('exec gosu "$PUID:$PGID" env HOME=/tmp XDG_CACHE_HOME=/tmp/.cache "$@"'),
  "entrypoint must exec the application with numeric PUID and PGID",
);

const storageBootstrapIndex = entrypoint.indexOf('for storage_path in "$UPLOAD_DIR" "$BACKUP_DIR"');
const preflightIndex = entrypoint.indexOf('node "$APP_DIR/docker/preflight.mjs"');
const migrateIndex = entrypoint.indexOf('"$APP_DIR/node_modules/.bin/prisma" migrate deploy');
const privilegeDropIndex = entrypoint.indexOf('exec gosu "$PUID:$PGID"');
assert(storageBootstrapIndex >= 0, "entrypoint must bootstrap persistent storage");
assert(
  storageBootstrapIndex < preflightIndex && preflightIndex < migrateIndex && migrateIndex < privilegeDropIndex,
  "storage, preflight and migrations must finish before the final privilege drop",
);
assert(packageJson.dependencies?.pg, "pg must remain a direct production dependency");
assert(packageJson.dependencies?.prisma, "Prisma CLI must remain a production dependency for migrate deploy");

const requireFromPreflight = createRequire(new URL("../docker/preflight.mjs", import.meta.url));
requireFromPreflight.resolve("pg");
requireFromPreflight.resolve("prisma/package.json");

console.log(`Validated ${runtimeScriptCopies.length} Docker runtime Node script path(s) and production dependency resolution.`);
