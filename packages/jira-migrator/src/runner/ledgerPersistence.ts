export function createChangeAwarePersister<T>(
  initial: T,
  write: (next: T, expected: T) => Promise<void>,
): (next: T) => Promise<boolean> {
  let persisted = initial;
  return async (next) => {
    if (next === persisted) return false;
    await write(next, persisted);
    persisted = next;
    return true;
  };
}

export interface BufferedChangeAwarePersister<T> {
  checkpoint(next: T): Promise<boolean>;
  flush(): Promise<boolean>;
}

export function createBufferedChangeAwarePersister<T>(
  initial: T,
  write: (next: T, expected: T) => Promise<void>,
  options: {
    batchSize: number;
    maxDelayMs: number;
    now?: () => number;
  },
): BufferedChangeAwarePersister<T> {
  if (options.batchSize < 1 || options.maxDelayMs < 0) {
    throw new Error("invalid_ledger_batch_options");
  }
  const now = options.now ?? Date.now;
  const persistChanged = createChangeAwarePersister(initial, write);
  let persisted = initial;
  let pending = initial;
  let dirtyCount = 0;
  let lastFlushAt = now();

  const flush = async (): Promise<boolean> => {
    if (pending === persisted) return false;
    const next = pending;
    await persistChanged(next);
    persisted = next;
    dirtyCount = 0;
    lastFlushAt = now();
    return true;
  };

  return {
    async checkpoint(next) {
      if (next !== pending) {
        pending = next;
        dirtyCount += 1;
      }
      if (pending === persisted) return false;
      if (
        dirtyCount < options.batchSize &&
        now() - lastFlushAt < options.maxDelayMs
      ) {
        return false;
      }
      return flush();
    },
    flush,
  };
}
