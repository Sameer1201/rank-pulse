import { Response } from "express";

interface SSEClient {
  res: Response;
  userId: number;
  pingInterval: ReturnType<typeof setInterval>;
}

const clientMap = new Map<number, SSEClient[]>();

export function addSSEClient(userId: number, res: Response): () => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const pingInterval = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { cleanup(); }
  }, 25000);

  const client: SSEClient = { res, userId, pingInterval };
  const existing = clientMap.get(userId) ?? [];
  clientMap.set(userId, [...existing, client]);

  function cleanup() {
    clearInterval(pingInterval);
    const current = clientMap.get(userId) ?? [];
    const updated = current.filter((c) => c !== client);
    if (updated.length === 0) clientMap.delete(userId);
    else clientMap.set(userId, updated);
  }

  res.on("close", cleanup);
  res.on("error", cleanup);

  return cleanup;
}

export function sendSSEToUser(userId: number, event: string, data: unknown): void {
  const userClients = clientMap.get(userId) ?? [];
  if (userClients.length === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of userClients) {
    try { client.res.write(payload); } catch { /* already closed */ }
  }
}

export function getConnectedUserIds(): number[] {
  return Array.from(clientMap.keys());
}
