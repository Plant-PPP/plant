import { readCappedBytes } from "@plant/shared";

// A request's body as text, read up to `limit` bytes whatever length it
// claims; null when it is longer.
export async function boundedText(
  request: Request,
  limit: number,
): Promise<string | null> {
  const bytes = await readCappedBytes(request, limit, { over: "fail" });
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
