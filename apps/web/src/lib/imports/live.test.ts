import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { watchImports } from "./live";

type Listener = {
  type: string;
  filter: Record<string, string>;
  callback: (payload: unknown) => void;
};

function fakeClient(auth: Promise<void> = Promise.resolve()) {
  const channels: {
    ref: unknown;
    topic: string;
    options: unknown;
    listeners: Listener[];
    status?: (status: string) => void;
  }[] = [];
  const removed: unknown[] = [];
  const client = {
    realtime: { setAuth: () => auth },
    channel: (topic: string, options: unknown) => {
      const entry = {
        ref: undefined as unknown,
        topic,
        options,
        listeners: [] as Listener[],
        status: undefined as ((status: string) => void) | undefined,
      };
      channels.push(entry);
      const channel = {
        on: (
          type: string,
          filter: Record<string, string>,
          callback: (payload: unknown) => void,
        ) => {
          entry.listeners.push({ type, filter, callback });
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          entry.status = callback;
          return channel;
        },
      };
      entry.ref = channel;
      return channel;
    },
    removeChannel: async (channel: unknown) => {
      removed.push(channel);
      return "ok";
    },
  };
  return {
    client: client as unknown as SupabaseClient<Database>,
    channels,
    removed,
  };
}

// Lets the setAuth the subscription waits for settle.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

it("follows the user's inserts and updates, never deletes, once the server listens", async () => {
  const { client, channels } = fakeClient();
  watchImports(client, "u1", jest.fn());
  await settled();
  const [channel] = channels;
  expect(channel!.topic).toMatch(/^imports:u1:/);
  expect(channel!.options).toEqual({
    config: { postgres_changes_options: { wait: true } },
  });
  expect(
    channel!.listeners.map(({ type, filter }) => ({ type, ...filter })),
  ).toEqual([
    {
      type: "postgres_changes",
      event: "INSERT",
      schema: "public",
      table: "imports",
      filter: "user_id=eq.u1",
    },
    {
      type: "postgres_changes",
      event: "UPDATE",
      schema: "public",
      table: "imports",
      filter: "user_id=eq.u1",
    },
  ]);
});

it("gives every subscription its own topic", async () => {
  const { client, channels } = fakeClient();
  watchImports(client, "u1", jest.fn());
  watchImports(client, "u1", jest.fn());
  await settled();
  expect(channels[0]!.topic).not.toBe(channels[1]!.topic);
});

it("calls back on each change and each time it subscribes, not on an error", async () => {
  const { client, channels } = fakeClient();
  const onChange = jest.fn();
  watchImports(client, "u1", onChange);
  await settled();
  const [channel] = channels;
  channel!.status!("CHANNEL_ERROR");
  expect(onChange).not.toHaveBeenCalled();
  channel!.status!("SUBSCRIBED");
  channel!.listeners[0]!.callback({ errors: null });
  channel!.listeners[1]!.callback({ errors: null });
  channel!.status!("SUBSCRIBED");
  expect(onChange).toHaveBeenCalledTimes(4);
});

it("ignores a 401 another user's change sends a subscriber without a grant", async () => {
  const { client, channels } = fakeClient();
  const onChange = jest.fn();
  watchImports(client, "u1", onChange);
  await settled();
  channels[0]!.listeners[0]!.callback({ errors: ["Error 401: Unauthorized"] });
  expect(onChange).not.toHaveBeenCalled();
});

it("calls back nothing a leaving channel still delivers", async () => {
  const { client, channels } = fakeClient();
  const onChange = jest.fn();
  const stop = watchImports(client, "u1", onChange);
  await settled();
  stop();
  channels[0]!.listeners[1]!.callback({ errors: null });
  channels[0]!.status!("SUBSCRIBED");
  expect(onChange).not.toHaveBeenCalled();
});

it("removes the channel when stopped", async () => {
  const { client, channels, removed } = fakeClient();
  const stop = watchImports(client, "u1", jest.fn());
  await settled();
  stop();
  expect(removed).toEqual([channels[0]!.ref]);
});

it("joins only once the session's token is set, and not at all if stopped first", async () => {
  let setAuth: () => void = () => {};
  const auth = new Promise<void>((resolve) => (setAuth = resolve));
  const { client, channels } = fakeClient(auth);
  const stop = watchImports(client, "u1", jest.fn());
  watchImports(client, "u1", jest.fn());
  await settled();
  expect(channels).toHaveLength(0);
  stop();
  setAuth();
  await settled();
  expect(channels).toHaveLength(1);
});

it("still joins when setting the token fails", async () => {
  const { client, channels } = fakeClient(Promise.reject(new Error("auth")));
  watchImports(client, "u1", jest.fn());
  await settled();
  expect(channels).toHaveLength(1);
});
