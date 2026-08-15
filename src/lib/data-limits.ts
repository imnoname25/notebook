function positiveMegabytes(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 1024 * 1024;
}

export const MAX_IMPORT_ENTRIES = 10_000;
export const MAX_IMPORT_JSON_BYTES = 50 * 1024 * 1024;
export function maxImportArchiveBytes() { return positiveMegabytes("MAX_IMPORT_SIZE_MB", 250); }
export function maxImportUncompressedBytes() { return positiveMegabytes("MAX_IMPORT_UNCOMPRESSED_MB", 1024); }
