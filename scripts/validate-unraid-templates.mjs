import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const definitions = [
  {
    file: "unraid/notebook.xml",
    repository: "ghcr.io/imnoname25/notebook:latest",
    name: "notebook",
    requiredTargets: ["3000", "APP_ORIGIN", "DATABASE_URL", "/data/uploads", "/data/backups", "SETTINGS_ENCRYPTION_KEY", "PUID", "PGID", "UMASK"],
  },
  {
    file: "unraid/notebook-postgres.xml",
    repository: "postgres:17-alpine",
    name: "notebook-postgres",
    requiredTargets: ["/var/lib/postgresql/data", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "TZ"],
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: true,
  isArray: (name, jPath) => name === "Config" && jPath === "Container.Config",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const definition of definitions) {
  const absolutePath = path.join(root, definition.file);
  const xml = readFileSync(absolutePath, "utf8");
  const validation = XMLValidator.validate(xml);
  assert(validation === true, `${definition.file}: malformed XML (${validation.err?.msg ?? "unknown error"})`);

  const container = parser.parse(xml).Container;
  assert(container.version === "2", `${definition.file}: Container version must be 2`);
  assert(container.Name === definition.name, `${definition.file}: unexpected Name`);
  assert(container.Repository === definition.repository, `${definition.file}: unexpected Repository`);
  assert(container.Network === "notebook-net", `${definition.file}: expected notebook-net`);
  assert(container.Privileged === "false", `${definition.file}: container must not be privileged`);
  for (const field of ["Registry", "Support", "Project", "Overview", "Category", "TemplateURL", "Icon"]) {
    assert(typeof container[field] === "string" && container[field].length > 0, `${definition.file}: missing ${field}`);
  }

  const configs = container.Config ?? [];
  const targets = configs.map((config) => config.Target);
  assert(new Set(targets).size === targets.length, `${definition.file}: duplicate Config target`);
  for (const target of definition.requiredTargets) {
    assert(targets.includes(target), `${definition.file}: missing Config target ${target}`);
  }

  const sensitiveTargets = ["DATABASE_URL", "SETTINGS_ENCRYPTION_KEY", "POSTGRES_PASSWORD"];
  for (const config of configs.filter((item) => sensitiveTargets.includes(item.Target))) {
    assert(config.Mask === "true", `${definition.file}: ${config.Target} must be masked`);
    assert((config["#text"] ?? "") === "", `${definition.file}: ${config.Target} must not contain a secret default`);
  }

  const iconPath = path.join(root, "public/icons/icon-512.png");
  assert(container.Icon.endsWith("/public/icons/icon-512.png"), `${definition.file}: icon URL must reference the repository PNG`);
  assert(existsSync(iconPath), `${definition.file}: referenced icon is missing`);

  if (definition.name === "notebook") {
    assert(container.WebUI === "http://[IP]:[PORT:3000]/", `${definition.file}: invalid WebUI`);
  } else {
    assert(!targets.includes("5432"), `${definition.file}: PostgreSQL must not publish port 5432`);
  }
}

console.log(`Validated ${definitions.length} Unraid template XML files.`);
