export function applyPageOrder<T extends { id: string; sortOrder: number }>(pages: T[], ids: readonly string[]): T[] {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return pages.map(page => {
    const sortOrder = positions.get(page.id);
    return sortOrder === undefined || sortOrder === page.sortOrder ? page : { ...page, sortOrder };
  });
}

type PendingOrder = {
  confirmed: readonly string[];
  latest: readonly string[];
  done: Promise<void>;
};

export class PageOrderQueue {
  private readonly pending = new Map<string, PendingOrder>();
  private revision = 0;

  get busy() {
    return this.pending.size > 0;
  }

  current(sectionId: string) {
    return this.pending.get(sectionId)?.latest;
  }

  async read<T>(sectionId: string, read: () => Promise<T>): Promise<T> {
    for (;;) {
      const pending = this.pending.get(sectionId);
      if (pending) {
        await pending.done;
        continue;
      }
      const revision = this.revision;
      const result = await read();
      if (revision === this.revision) return result;
    }
  }

  save(
    sectionId: string,
    before: readonly string[],
    ids: readonly string[],
    write: () => Promise<unknown>,
    onFailure: (cause: unknown, confirmed: readonly string[]) => Promise<void>,
  ) {
    this.revision++;
    const order = this.pending.get(sectionId) ?? { confirmed: before, latest: ids, done: Promise.resolve() };
    this.pending.set(sectionId, order);
    order.latest = ids;
    order.done = order.done.then(async () => {
      try {
        await write();
        order.confirmed = ids;
      } catch (cause) {
        if (order.latest === ids) await onFailure(cause, order.confirmed);
      } finally {
        if (order.latest === ids) this.pending.delete(sectionId);
      }
    });
    return order.done;
  }
}
