// For tests: serverLog's lines, parsed, from the console method each level
// writes to. Anything else on the console (an SDK's warning) is dropped.
// Restore with jest.restoreAllMocks().
export function captureServerLog(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const collect = (line?: unknown) => {
    if (typeof line === "string" && line.startsWith("{")) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
  };
  for (const method of ["log", "warn", "error"] as const) {
    jest
      .spyOn(console, method)
      .mockImplementation((...args: unknown[]) => collect(args[0]));
  }
  return lines;
}
