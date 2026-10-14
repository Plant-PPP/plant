// A response's or request's body read at most `cap` bytes far, so a peer that
// sends no length or a wrong one cannot fill memory. Past the cap, "fail"
// gives null (a body that declares a larger length is refused unread) and
// "cut" keeps the first `cap` bytes. A failed read rejects; a failed cancel of
// the rest is ignored, so it never hides that the body was too large.
export async function readCappedBytes(
  response: Pick<Response, "headers" | "body">,
  cap: number,
  { over }: { over: "cut" | "fail" },
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (over === "fail" && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      await reader.cancel().catch(() => undefined);
      if (over === "fail") return null;
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      break;
    }
    size += value.byteLength;
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
