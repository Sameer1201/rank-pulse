import { Router } from "express";
import { db, aiApiKeysTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";

const router = Router();

const VALID_PROVIDERS = [
  "openrouter", "openai", "anthropic", "google", "groq",
  "nvidia", "mistral", "codestral", "huggingface",
  "vercel", "kilo", "opencodezen", "cerebras", "cohere",
];

function getUser(req: any) {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole ?? null;
  return { userId, userRole };
}

function maskKey(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 6) + "••••••••" + value.slice(-4);
}

// GET /api/ai-config/apikeys
router.get("/apikeys", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const rows = await db
      .select()
      .from(aiApiKeysTable)
      .orderBy(asc(aiApiKeysTable.priority), asc(aiApiKeysTable.createdAt));
    res.json(rows.map((r) => ({
      id: r.id,
      label: r.label,
      provider: r.provider,
      masked: maskKey(r.value),
      priority: r.priority,
      limitExhausted: r.limitExhausted,
      createdAt: r.createdAt,
    })));
  } catch {
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

// POST /api/ai-config/apikeys
router.post("/apikeys", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { label, apiKey, provider } = req.body as { label?: string; apiKey?: string; provider?: string };
  if (!apiKey?.trim()) { res.status(400).json({ error: "apiKey is required" }); return; }

  const resolvedProvider = VALID_PROVIDERS.includes(provider ?? "") ? provider! : "openrouter";

  try {
    const existing = await db.select({ priority: aiApiKeysTable.priority }).from(aiApiKeysTable);
    const maxPriority = existing.length > 0 ? Math.max(...existing.map((r) => r.priority)) : -1;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await db.insert(aiApiKeysTable).values({
      id,
      label: label?.trim() || `Key ${existing.length + 1}`,
      value: apiKey.trim(),
      provider: resolvedProvider,
      priority: maxPriority + 1,
      limitExhausted: false,
    });
    res.json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "Failed to add API key" });
  }
});

// PATCH /api/ai-config/apikeys/:id/reset-limit
// Clears the limitExhausted flag so the key is retried again
router.patch("/apikeys/:id/reset-limit", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    await db.update(aiApiKeysTable)
      .set({ limitExhausted: false })
      .where(eq(aiApiKeysTable.id, req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to reset limit" });
  }
});

// DELETE /api/ai-config/apikeys/:id
router.delete("/apikeys/:id", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    await db.delete(aiApiKeysTable).where(eq(aiApiKeysTable.id, req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

export default router;
