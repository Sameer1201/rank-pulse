/** Bound small public authentication payloads even when Content-Length is absent. */
export async function boundedAuthRequest(request: Request, limit = 65536): Promise<Request | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null;
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const bounded = new Request(request, { body });
  const cf = (request as Request & { cf?: unknown }).cf;
  if (cf && !(bounded as Request & { cf?: unknown }).cf) Object.defineProperty(bounded, 'cf', { value: cf });
  return bounded;
}
