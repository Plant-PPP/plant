import type { Database } from "@plant/shared";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

import { reportClientError } from "@/lib/reports/client";

let subscriptions = 0;

// Calls onChange when one of the user's imports is added or changes, and each
// time the channel subscribes, to catch up on what changed while it was not
// listening; realtime-js rejoins a channel after an error, not one the server
// closed. Deletes are not published
// (supabase/migrations/20261013160000_imports_realtime.sql). Returns the stop.
export function watchImports(
  client: SupabaseClient<Database>,
  userId: string,
  onChange: () => void,
): () => void {
  const filter = `user_id=eq.${userId}`;
  const topic = `imports:${userId}:${++subscriptions}`;
  let channel: RealtimeChannel | undefined;
  let stopped = false;
  // A leaving channel still delivers what was in flight.
  const changed = () => {
    if (!stopped) onChange();
  };
  // A 401 reaches every subscriber of the table without a grant, whatever
  // their filter, and carries no row.
  const received = (payload: { errors?: unknown }) => {
    if (!payload.errors) changed();
  };

  const subscribe = () => {
    if (stopped) return;
    channel = client
      // A fresh topic per subscription: a channel still leaving under the same
      // topic would be reused and never subscribe. `wait` holds SUBSCRIBED
      // until the server listens, so the catch-up misses nothing.
      .channel(topic, { config: { postgres_changes_options: { wait: true } } })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "imports", filter },
        received,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "imports", filter },
        received,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") changed();
        // realtime-js keeps rejoining; the server hears of each failure.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportClientError({ kind: "realtime", type: status });
        }
      });
  };

  // A channel joins with the token Realtime holds at that moment, and Realtime
  // keeps the join's claims for postgres_changes: joined before the session's
  // token is set, it would listen as anon and get every change as a 401.
  void client.realtime.setAuth().then(subscribe, subscribe);

  return () => {
    stopped = true;
    if (channel) void client.removeChannel(channel);
  };
}
