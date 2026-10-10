import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, metaSessionsTable } from "@workspace/db";
import { getSignedUserId } from "../lib/authUtils";

const router = Router();

function getUser(req: any) {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole ?? null;
  return { userId, userRole };
}

// GET /api/meta-sessions
router.get("/", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const rows = await db.select().from(metaSessionsTable).orderBy(metaSessionsTable.updatedAt);
    res.json(rows.reverse());
  } catch (err) {
    req.log.error({ err }, "Failed to list meta sessions");
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// POST /api/meta-sessions
router.post("/", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { id, name, testTitle, fileNames, questionCount, rows } = req.body as {
    id: string; name: string; testTitle?: string | null;
    fileNames: string[]; questionCount: number; rows: any[];
  };
  if (!id || !name) { res.status(400).json({ error: "id and name are required" }); return; }
  try {
    const [session] = await db
      .insert(metaSessionsTable)
      .values({ id, name, testTitle: testTitle ?? null, fileNames, questionCount, rows, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: metaSessionsTable.id,
        set: { name, testTitle: testTitle ?? null, fileNames, questionCount, rows, updatedAt: new Date() },
      })
      .returning();
    res.json(session);
  } catch (err) {
    req.log.error({ err }, "Failed to upsert meta session");
    res.status(500).json({ error: "Failed to save session" });
  }
});

// PUT /api/meta-sessions/:id
router.put("/:id", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { name, testTitle, fileNames, questionCount, rows } = req.body as {
    name: string; testTitle?: string | null;
    fileNames: string[]; questionCount: number; rows: any[];
  };
  try {
    const [session] = await db
      .update(metaSessionsTable)
      .set({ name, testTitle: testTitle ?? null, fileNames, questionCount, rows, updatedAt: new Date() })
      .where(eq(metaSessionsTable.id, req.params.id))
      .returning();
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(session);
  } catch (err) {
    req.log.error({ err }, "Failed to update meta session");
    res.status(500).json({ error: "Failed to update session" });
  }
});

// DELETE /api/meta-sessions/:id
router.delete("/:id", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const [deleted] = await db
      .delete(metaSessionsTable)
      .where(eq(metaSessionsTable.id, req.params.id))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Session not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete meta session");
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
