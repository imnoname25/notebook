import { createHash } from "node:crypto";

export const PAGE_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const PAGE_VERSION_MAX_COUNT = 100;
export const PAGE_VERSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export type PageVersionPolicy = { intervalMs: number; maxCount: number; maxAgeMs: number };
export const DEFAULT_PAGE_VERSION_POLICY: PageVersionPolicy = { intervalMs: PAGE_SNAPSHOT_INTERVAL_MS, maxCount: PAGE_VERSION_MAX_COUNT, maxAgeMs: PAGE_VERSION_MAX_AGE_MS };

export type SnapshotReason = "interval" | "manual" | "before_restore";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function pageContentHash(title: string, content: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue({ title, content }))).digest("hex");
}

export function shouldCreateSnapshot(input: {
  currentHash: string;
  latestHash?: string;
  latestCreatedAt?: Date;
  reason: SnapshotReason;
  now: Date;
}, policy: PageVersionPolicy = DEFAULT_PAGE_VERSION_POLICY) {
  if (input.latestHash === input.currentHash) return false;
  if (input.reason !== "interval") return true;
  return !input.latestCreatedAt || input.now.getTime() - input.latestCreatedAt.getTime() >= policy.intervalMs;
}

export function retainedVersionIds<T extends { id: string; createdAt: Date }>(versions: T[], now: Date, policy: PageVersionPolicy = DEFAULT_PAGE_VERSION_POLICY) {
  const cutoff = now.getTime() - policy.maxAgeMs;
  return versions
    .filter((version) => version.createdAt.getTime() >= cutoff)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, policy.maxCount)
    .map((version) => version.id);
}
