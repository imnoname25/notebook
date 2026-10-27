export type SaveStatus = "saving" | "saved" | "error";

/** One document, one ordered writer. A failed payload remains dirty in memory. */
export class EditorSaveQueue<T> {
  private version = 0;
  private confirmed = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(private latest: T, private send: (payload: T, manual: boolean) => Promise<void>, private status: (value: SaveStatus) => void) {}
  update(payload: T) { this.latest = payload; this.version++; this.status("saving"); }
  isDirty() { return this.confirmed < this.version; }
  save(manual = false) {
    const version = this.version;
    const payload = this.latest;
    const operation = this.tail.then(async () => {
      if (!manual && version <= this.confirmed) return;
      this.status("saving");
      try {
        await this.send(payload, manual);
        this.confirmed = Math.max(this.confirmed, version);
        if (!this.isDirty()) this.status("saved");
      } catch (error) { this.status("error"); throw error; }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  async flush(manual = false) {
    await this.tail;
    if (manual) await this.save(true);
    while (this.isDirty()) await this.save(false);
  }
}

/** Pending intentions supersede earlier fetches; active writes are always awaited. */
export class DocumentTransitionQueue {
  private version = 0;
  private tail: Promise<unknown> = Promise.resolve();
  cancel() { this.version++; }
  async idle() { await this.tail; }
  run<T>(operation: (current: () => boolean) => Promise<T>): Promise<T | undefined> {
    const version = ++this.version;
    const current = () => version === this.version;
    const result = this.tail.then(() => current() ? operation(current) : undefined);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
