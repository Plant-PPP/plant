export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

// Pass ids and counts, never amounts, holdings or extracted data.
export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields, error?: unknown): void;
};

// A set of bounded names as one log value: distinct, sorted, comma-joined.
export const logList = (values: readonly string[]): string =>
  [...new Set(values)].sort().join(",");
