import { EditorSaveQueue, type SaveStatus } from "./editor-save-queue";
import type { QuickNote, QuickNotePatch } from "./quick-note";

type Snapshot = { note: QuickNote; status: SaveStatus; dirty: boolean; error: string };
export type StickerTransport = (id: string, patch: QuickNotePatch, base: QuickNote) => Promise<QuickNote>;
export class StickerWriter {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private base: QuickNote;
  private local: QuickNote;
  private pending: QuickNotePatch = {};
  private queue: EditorSaveQueue<QuickNotePatch>;
  private snapshot: Snapshot;
  private error = "";
  private generation = 0;
  constructor(note: QuickNote, private send: StickerTransport, private onError: (error: Error) => void) {
    this.base = this.local = note;
    this.snapshot = { note, status: "saved", dirty: false, error: "" };
    this.queue = this.makeQueue();
  }
  private makeQueue() {
    return new EditorSaveQueue<QuickNotePatch>({}, async patch => {
      try {
        const saved = await this.send(this.base.id, patch, this.base);
        this.base = saved;
        this.local = { ...saved, ...this.pending };
        this.publish("saving");
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Не удалось сохранить стикер";
        throw error;
      }
    }, status => {
      if (status === "saved") { this.pending = {};this.local = this.base;this.error = ""; }
      this.publish(status);
      if (status === "error") this.onError(new Error(this.error));
    });
  }
  private publish(status = this.snapshot.status) {
    this.snapshot = { note: this.local, status, dirty: this.queue?.isDirty() ?? false, error: this.error };
    this.listeners.forEach(listener => listener());
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener);return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  accept(note: QuickNote) {
    if (this.queue.isDirty() || note.updatedAt <= this.base.updatedAt) return;
    this.base = this.local = note; this.publish();
  }
  update(patch: QuickNotePatch, immediate = false) {
    this.generation++;
    this.pending = { ...this.pending, ...patch };
    this.local = { ...this.local, ...patch };
    this.queue.update({ ...this.pending });
    clearTimeout(this.timer);
    if (immediate) void this.flush().catch(() => undefined);
    else this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, 650);
  }
  async flush() { clearTimeout(this.timer);await this.queue.flush(false); }
  version() { return this.generation; }
  resetAfterCopy(remote: QuickNote | null, copiedVersion: number) {
    if (copiedVersion !== this.generation) return;
    clearTimeout(this.timer);this.pending = {};this.base = this.local = remote ?? this.local;
    this.error = "";this.queue = this.makeQueue();this.publish("saved");
  }
}
/** A single writer per sticker, scoped to one mounted account workspace. */
export class StickerSaveStore {
  private writers = new Map<string, StickerWriter>();
  private errorListeners = new Set<(error: Error) => void>();
  constructor(private send: StickerTransport) {}
  writer(note: QuickNote) {
    let writer = this.writers.get(note.id);
    if (!writer) {
      writer = new StickerWriter(note, this.send, error => this.errorListeners.forEach(listener => listener(error)));
      this.writers.set(note.id, writer);
    }
    return writer;
  }
  subscribeErrors(listener: (error: Error) => void) { this.errorListeners.add(listener);return () => { this.errorListeners.delete(listener); }; }
  async flushAll() { await Promise.all([...this.writers.values()].map(writer => writer.flush())); }
  isDirty() { return [...this.writers.values()].some(writer => writer.getSnapshot().dirty); }
}
