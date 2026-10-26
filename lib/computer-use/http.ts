export async function limitedBody(request: Request, limit = 2_000_000) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new Error("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error("Request too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
