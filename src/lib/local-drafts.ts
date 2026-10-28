import { z } from "zod";
import { canonicalJson, type DocumentState } from "./document-state";
export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_MAX_BYTES = 2 * 1024 * 1024;
const recordSchema = z.object({ key: z.string(), userId: z.string(), pageId: z.string(), writerId: z.string(), sequence: z.number().int().nonnegative(), baseRevision: z.number().int().nonnegative(), fingerprint: z.string(), title: z.string(), content: z.array(z.unknown()), updatedAt: z.number().finite() });
export type LocalDraft = z.infer<typeof recordSchema>;
type Meta = Omit<LocalDraft, "title" | "content"> & { bytes: number };
const disabled = new Set<string>();let connection: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;
function broadcast() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel("notebook-recovery-v1"); } catch { return; }
    channel.onmessage = event => { if (event.data?.type === "logout" && typeof event.data.userId === "string") { disabled.add(event.data.userId);void clearDrafts(event.data.userId, false).catch(() => undefined); } };
  }
}
export function activateDraftUser(userId: string) { disabled.delete(userId);broadcast(); }
function database() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB недоступна"));return; }
    const request = indexedDB.open("notebook-recovery-v1", 1);
    request.onupgradeneeded = () => { for (const name of ["drafts", "metadata"]) { const store = request.result.createObjectStore(name, { keyPath: "key" });store.createIndex("userId", "userId");if (name === "drafts") store.createIndex("userPage", ["userId", "pageId"]); } };
    request.onsuccess = () => { const db = request.result;db.onversionchange = () => { db.close();connection = null; };resolve(db); };
    request.onerror = () => { connection = null;reject(request.error); };
    request.onblocked = () => { connection = null;reject(new Error("Хранилище черновиков занято другой вкладкой")); };
  });
  return connection;
}
function done(transaction: IDBTransaction) { return new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve();transaction.onerror = () => reject(transaction.error);transaction.onabort = () => reject(transaction.error ?? new Error("Запись черновика отменена")); }); }
export async function documentFingerprint(value: DocumentState) {
  const serialized = canonicalJson({ title: value.title, content: value.content });
  if (!crypto.subtle) return serialized; // HTTP self-hosting: exact comparison, never a collision-prone checksum.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export const draftKey = (userId: string, pageId: string, writerId: string) => JSON.stringify([userId, pageId, writerId]);
export function mayReplaceDraft(existing: Pick<LocalDraft, "sequence"> | undefined, sequence: number) { return !existing || existing.sequence <= sequence; }
export function matchesAcknowledgement(record: Pick<LocalDraft, "fingerprint"> | undefined, fingerprint: string) { return record?.fingerprint === fingerprint; }
export async function writeDraft(input: DocumentState & { userId: string; pageId: string; writerId: string; sequence: number; baseRevision: number }) {
  if (disabled.has(input.userId)) return;
  const record: LocalDraft = { ...input, key: draftKey(input.userId, input.pageId, input.writerId), fingerprint: await documentFingerprint(input), updatedAt: Date.now() };
  const bytes = new Blob([JSON.stringify(record)]).size;if (bytes > DRAFT_MAX_BYTES) throw new Error("Черновик больше 2 МБ; локальная копия не обновлена");
  const db = await database();if (disabled.has(input.userId)) return;
  const transaction = db.transaction(["drafts", "metadata"], "readwrite");const completed = done(transaction);let failure: Error | null = null;
  const metadata = transaction.objectStore("metadata"), store = transaction.objectStore("drafts");
  const request = metadata.index("userId").getAll(input.userId);
  request.onsuccess = () => {
    const entries = request.result as Meta[];const current = entries.find(entry => entry.key === record.key);
    if (!mayReplaceDraft(current, input.sequence)) return;
    const live = entries.filter(entry => entry.updatedAt >= Date.now() - DRAFT_TTL && entry.key !== record.key);
    for (const entry of entries) if (entry.updatedAt < Date.now() - DRAFT_TTL) { store.delete(entry.key);metadata.delete(entry.key); }
    if (live.length >= 50 || live.reduce((total, entry) => total + entry.bytes, 0) + bytes > 25 * 1024 * 1024) { failure = new Error("Локальное хранилище заполнено; существующие несохранённые черновики сохранены");transaction.abort();return; }
    store.put(record);const { title: _title, content: _content, ...meta } = record;void _title;void _content;metadata.put({ ...meta, bytes });
  };
  try { await completed; } catch (error) { throw failure ?? error; }
}
export async function listDrafts(userId: string, pageId: string): Promise<LocalDraft[]> {
  broadcast();await pruneDrafts(userId);const db = await database();const transaction = db.transaction("drafts", "readonly");const request = transaction.objectStore("drafts").index("userPage").getAll([userId, pageId]);
  return new Promise((resolve, reject) => { request.onerror = () => reject(request.error);request.onsuccess = () => resolve((request.result as unknown[]).flatMap(value => { const parsed = recordSchema.safeParse(value);return parsed.success && parsed.data.updatedAt >= Date.now() - DRAFT_TTL ? [parsed.data] : []; }).sort((a, b) => b.updatedAt - a.updatedAt)); });
}
export async function pruneDrafts(userId: string) {
  const db = await database();const transaction = db.transaction(["drafts", "metadata"], "readwrite");const completed = done(transaction);const request = transaction.objectStore("metadata").index("userId").getAll(userId);
  request.onsuccess = () => { for (const meta of request.result as Meta[]) if (meta.updatedAt < Date.now() - DRAFT_TTL) { transaction.objectStore("drafts").delete(meta.key);transaction.objectStore("metadata").delete(meta.key); } };
  await completed;
}
export async function discardDraft(record: Pick<LocalDraft, "key" | "sequence" | "fingerprint">, exactSequence = true) {
  const db = await database();const transaction = db.transaction(["drafts", "metadata"], "readwrite");const completed = done(transaction);let removed = false;
  const request = transaction.objectStore("metadata").get(record.key);
  request.onsuccess = () => { const meta = request.result as Meta | undefined;if (matchesAcknowledgement(meta, record.fingerprint) && (!exactSequence || meta!.sequence === record.sequence)) { transaction.objectStore("drafts").delete(record.key);transaction.objectStore("metadata").delete(record.key);removed = true; } };
  await completed;return removed;
}
export async function acknowledgeDraft(userId: string, pageId: string, writerId: string, state: DocumentState) {
  await discardDraft({ key: draftKey(userId, pageId, writerId), sequence: 0, fingerprint: await documentFingerprint(state) }, false);
}
export async function clearDrafts(userId: string, announce = true) {
  disabled.add(userId);broadcast();if (announce) channel?.postMessage({ type: "logout", userId });
  const db = await database();const transaction = db.transaction(["drafts", "metadata"], "readwrite");const completed = done(transaction);const request = transaction.objectStore("metadata").index("userId").getAllKeys(userId);
  request.onsuccess = () => { for (const key of request.result) { transaction.objectStore("drafts").delete(key);transaction.objectStore("metadata").delete(key); } };
  await completed;
}
export async function hasLocalDrafts(userId: string) {
  const db = await database();const request = db.transaction("metadata", "readonly").objectStore("metadata").index("userId").count(userId);
  return new Promise<boolean>((resolve, reject) => { request.onsuccess = () => resolve(request.result > 0);request.onerror = () => reject(request.error); });
}
