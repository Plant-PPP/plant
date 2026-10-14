// A fixed one-minute window per sender and for the whole instance, so one
// sender cannot use up what every other sender gets. In memory, per serverless
// instance: it bounds what one instance logs, not what a flood costs.
const WINDOW_MS = 60_000;

export type Verdict = "logged" | "dropped" | "dropped_first";

export function reportLimiter({
  now = () => Date.now(),
  perSender = 20,
  perInstance = 300,
  // Senders kept per window; past it, the window counts the rest as one.
  maxSenders = 1_000,
}: {
  now?: () => number;
  perSender?: number;
  perInstance?: number;
  maxSenders?: number;
} = {}) {
  let windowStart = 0;
  let total = 0;
  let dropped = 0;
  const senders = new Map<string, number>();

  return (sender: string): Verdict => {
    const at = now();
    if (at - windowStart >= WINDOW_MS) {
      windowStart = at;
      total = 0;
      dropped = 0;
      senders.clear();
    }
    const key = senders.has(sender) || senders.size < maxSenders ? sender : "*";
    const count = (senders.get(key) ?? 0) + 1;
    senders.set(key, count);
    // Only what a sender may log counts against the instance, so a flooder
    // spends its own quota and nobody else's.
    if (count <= perSender && total < perInstance) {
      total += 1;
      return "logged";
    }
    dropped += 1;
    // One line says the window started dropping; the rest are silent.
    return dropped === 1 ? "dropped_first" : "dropped";
  };
}

// A per-user bound on an action, with no instance budget: users who spend
// theirs lock out nobody else. Past maxUsers in a window the rest share one
// count, which bounds memory.
export function userLimiter({
  now,
  perUser,
  maxUsers = 10_000,
}: {
  now?: () => number;
  perUser: number;
  maxUsers?: number;
}) {
  const limit = reportLimiter({
    now,
    perSender: perUser,
    perInstance: Number.POSITIVE_INFINITY,
    maxSenders: maxUsers,
  });
  return (userId: string): boolean => limit(userId) === "logged";
}
