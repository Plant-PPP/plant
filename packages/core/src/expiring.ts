// A read kept for ttlMs from when it started: calls in between share it, and
// one that fails is read again on the next call.
export function expiring<T>(
  read: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<T> {
  let slot: { at: number; value: Promise<T> } | null = null;
  return () => {
    const at = now();
    if (slot && at - slot.at < ttlMs) return slot.value;
    const value = read();
    const kept = { at, value };
    slot = kept;
    value.catch(() => {
      if (slot === kept) slot = null;
    });
    return value;
  };
}
