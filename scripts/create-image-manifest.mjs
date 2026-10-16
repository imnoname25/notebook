import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const sha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF;
if (!/^[a-f0-9]{40}$/.test(sha ?? "") || typeof ref !== "string") throw new Error("Missing build identity");
const migrations = [];
for (const entry of (await readdir("prisma/migrations", { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
  if (!entry.isDirectory()) continue;
  if (!/^[a-zA-Z0-9_]+$/.test(entry.name)) throw new Error("Invalid migration name");
  const sql = await readFile(`prisma/migrations/${entry.name}/migration.sql`);
  migrations.push({ name: entry.name, sha256: createHash("sha256").update(sql).digest("hex") });
}
const { version } = JSON.parse(await readFile("package.json", "utf8"));
console.log(JSON.stringify({ format: 1, repository: "imnoname25/notebook", sha, ref, version, migrations }));
