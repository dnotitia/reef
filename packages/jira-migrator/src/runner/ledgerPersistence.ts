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
