import { lstatSync } from "node:fs";
import path from "node:path";

export function backupRoot() { return path.resolve(/* turbopackIgnore: true */ process.env.BACKUP_DIR ?? "./data/backups"); }

export function resolveBackupPath(filename: string) {
  // Validate the original basename with BOTH grammars, before resolve/normalize can hide traversal.
  // The portable character set also excludes URL encoding/schemes, NTFS streams and device syntax.
  const reservedDevice = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu;
  if (
    !filename || !/^[\p{L}\p{N}_.-]+$/u.test(filename) || /[. ]$/u.test(filename) ||
    reservedDevice.test(filename) ||
    path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename) ||
    path.posix.basename(filename) !== filename || path.win32.basename(filename) !== filename
  ) {
    throw new Error("Некорректное имя backup");
  }
  const root = backupRoot();
  const resolved = path.resolve(root, filename);
  // Require an immediate child, not a textual prefix (e.g. backups-other is outside backups).
  if (path.relative(root, resolved) !== filename) {
    throw new Error("Backup path выходит за пределы хранилища");
  }
  assertNoBackupLinks(resolved);
  return resolved;
}

function assertNoBackupLinks(resolved: string) {
  let current = path.parse(resolved).root;
  for (const component of path.relative(current, resolved).split(path.sep)) {
    current = path.join(current, component);
    // Missing directories/files are allowed during backup creation; other filesystem errors fail closed.
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry) return;
    if (entry.isSymbolicLink()) throw new Error("Backup path содержит символическую ссылку");
    if (current !== resolved && !entry.isDirectory()) throw new Error("Некорректная директория backup");
    if (current === resolved && !entry.isFile()) throw new Error("Backup должен быть обычным файлом");
  }
  // This is a resolution-time check, not an atomic open. BACKUP_DIR and its ancestors must stay
  // application/admin-controlled; archive creation already uses wx to avoid following an existing link.
}

export function backupFilename(date = new Date(), suffix = "") {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `notebook-backup-${timestamp}${suffix ? `-${suffix}` : ""}.zip`;
}

