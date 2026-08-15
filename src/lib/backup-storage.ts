import path from "node:path";

export function backupRoot() { return path.resolve(/* turbopackIgnore: true */ process.env.BACKUP_DIR ?? "./data/backups"); }

export function resolveBackupPath(filename: string) {
  if (!filename || filename.includes("\0") || path.isAbsolute(filename) || path.basename(filename) !== filename) throw new Error("Некорректное имя backup");
  const root = backupRoot(); const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Backup path выходит за пределы хранилища");
  return resolved;
}

export function backupFilename(date = new Date(), suffix = "") {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `notebook-backup-${timestamp}${suffix ? `-${suffix}` : ""}.zip`;
}

