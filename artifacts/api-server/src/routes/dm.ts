import { Router, type IRouter } from "express";
import { db, usersTable, directMessagesTable } from "@workspace/db";
import { eq, or, and, desc, inArray } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";

const router: IRouter = Router();

function requireAuth(req: any, res: any): { userId: number; role: string } | null {
  const userId = getSignedUserId(req);
  const roleCookie = req.cookies?.userRole;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return { userId, role: roleCookie ?? "student" };
}

function requireAdmin(req: any, res: any): { userId: number; role: string } | null {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (auth.role !== "admin" && auth.role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return auth;
}

function requireSuperAdmin(req: any, res: any): { userId: number; role: string } | null {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (auth.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return null;
  }
  return auth;
}

/* ── Determine which roles a given role can DM ─────────────────── */
function allowedPeerRoles(myRole: string): string[] {
  if (myRole === "student") return ["student"];
  if (myRole === "admin") return ["super_admin"];
  if (myRole === "super_admin") return ["admin"];
  return [];
}

function canDirectMessage(senderRole: string, receiverRole: string): boolean {
  return allowedPeerRoles(senderRole).includes(receiverRole);
}

function isSupportedDmPair(roleA: string | null | undefined, roleB: string | null | undefined): boolean {
  if (!roleA || !roleB) return false;
  return canDirectMessage(roleA, roleB) || canDirectMessage(roleB, roleA);
}

/* ── GET /api/dm/peers ─────────────────────────────────────────
   Returns users the current user is allowed to message:
   - student  → only other students
   - admin    → super admins only
   - super_admin → teachers only
───────────────────────────────────────────────────────────────── */
router.get("/dm/peers", async (req, res): Promise<void> => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const all = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(usersTable.fullName);

  const allowed = allowedPeerRoles(auth.role);
  const peers = all.filter((u) => u.id !== auth.userId && allowed.includes(u.role));

  res.json(peers);
});

/* ── GET /api/dm/conversations ─────────────────────────────────
   Returns a list of conversations for the current user.
───────────────────────────────────────────────────────────────── */
router.get("/dm/conversations", async (req, res): Promise<void> => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const messages = await db
    .select()
    .from(directMessagesTable)
    .where(
      or(
        eq(directMessagesTable.senderId, auth.userId),
        eq(directMessagesTable.receiverId, auth.userId),
      ),
    )
    .orderBy(desc(directMessagesTable.createdAt));

  const conversationMap = new Map<number, {
    peerId: number;
    lastMessage: string;
    lastAt: string;
    reportedCount: number;
  }>();

  for (const m of messages) {
    const peerId = m.senderId === auth.userId ? m.receiverId : m.senderId;
    const existing = conversationMap.get(peerId);
    if (!existing) {
      conversationMap.set(peerId, {
        peerId,
        lastMessage: m.content.slice(0, 60) + (m.content.length > 60 ? "…" : ""),
        lastAt: m.createdAt.toISOString(),
        reportedCount: m.isReported ? 1 : 0,
      });
      continue;
    }

    if (m.isReported) {
      existing.reportedCount += 1;
    }
  }

  const conversations = Array.from(conversationMap.values());
  const peerIds = conversations.map((c) => c.peerId);
  if (peerIds.length === 0) { res.json([]); return; }

  const peers = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.id, peerIds));

  const peerMap = new Map(peers.map((p) => [p.id, p]));

  res.json(
    conversations.map((c) => ({
      ...c,
      peer: peerMap.get(c.peerId) ?? null,
    })).filter((c) => c.peer && canDirectMessage(auth.role, c.peer.role)),
  );
});

/* ── GET /api/dm/:peerId ───────────────────────────────────────
   Returns all messages between current user and peerId.
───────────────────────────────────────────────────────────────── */
router.get("/dm/:peerId", async (req, res): Promise<void> => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const peerId = parseInt(req.params.peerId, 10);
  if (isNaN(peerId)) { res.status(400).json({ error: "Invalid peer ID" }); return; }

  const [peer] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, peerId));

  if (!peer) { res.status(404).json({ error: "Peer not found" }); return; }
  if (!canDirectMessage(auth.role, peer.role)) {
    res.status(403).json({ error: "You are not allowed to message this user" });
    return;
  }

  const messages = await db
    .select()
    .from(directMessagesTable)
    .where(
      or(
        and(eq(directMessagesTable.senderId, auth.userId), eq(directMessagesTable.receiverId, peerId)),
        and(eq(directMessagesTable.senderId, peerId), eq(directMessagesTable.receiverId, auth.userId)),
      ),
    )
    .orderBy(directMessagesTable.createdAt);

  res.json(messages);
});

/* ── POST /api/dm/:peerId ──────────────────────────────────────
   Send a message to peerId. Role restrictions enforced:
   - student  → student only
   - admin    → super admin only
   - super_admin → teacher only
───────────────────────────────────────────────────────────────── */
router.post("/dm/:peerId", async (req, res): Promise<void> => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const peerId = parseInt(req.params.peerId, 10);
  if (isNaN(peerId)) { res.status(400).json({ error: "Invalid peer ID" }); return; }

  const { content } = req.body;
  if (!content || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "Message content is required" }); return;
  }

  const [peer] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, peerId));

  if (!peer) { res.status(404).json({ error: "Peer not found" }); return; }
  if (peerId === auth.userId) { res.status(400).json({ error: "Cannot message yourself" }); return; }

  // Role-based restriction
  if (!canDirectMessage(auth.role, peer.role)) {
    res.status(403).json({ error: "You are not allowed to message this user" }); return;
  }

  const [msg] = await db.insert(directMessagesTable).values({
    senderId: auth.userId,
    receiverId: peerId,
    content: content.trim(),
  }).returning();

  res.status(201).json(msg);
});

/* ── POST /api/dm/message/:messageId/report ────────────────────
   Report a message. Any participant (sender or receiver) can report.
   Students can report any message they are part of.
───────────────────────────────────────────────────────────────── */
router.post("/dm/message/:messageId/report", async (req, res): Promise<void> => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const messageId = parseInt(req.params.messageId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const { reason } = req.body;

  // Either sender or receiver can report
  const [msg] = await db
    .select()
    .from(directMessagesTable)
    .where(
      and(
        eq(directMessagesTable.id, messageId),
        or(
          eq(directMessagesTable.senderId, auth.userId),
          eq(directMessagesTable.receiverId, auth.userId),
        ),
      ),
    );

  if (!msg) { res.status(404).json({ error: "Message not found or you are not a participant" }); return; }

  const [updated] = await db
    .update(directMessagesTable)
    .set({
      isReported: true,
      reportReason: typeof reason === "string" && reason.trim() ? reason.trim() : "Misbehaviour reported",
      reportedAt: new Date(),
    })
    .where(eq(directMessagesTable.id, messageId))
    .returning();

  res.json(updated);
});

/* ── GET /api/dm/admin/conversations ──────────────────────────
   Admin: only student↔student conversations.
   Super admin: all supported conversations.
───────────────────────────────────────────────────────────────── */
router.get("/dm/admin/conversations", async (req, res): Promise<void> => {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  const messages = await db
    .select()
    .from(directMessagesTable)
    .orderBy(desc(directMessagesTable.createdAt));

  const pairMap = new Map<string, {
    user1Id: number; user2Id: number; lastMessage: string; lastAt: string;
    totalMessages: number; reportedMessages: number;
  }>();

  for (const m of messages) {
    const [a, b] = m.senderId < m.receiverId ? [m.senderId, m.receiverId] : [m.receiverId, m.senderId];
    const key = `${a}-${b}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        user1Id: a, user2Id: b,
        lastMessage: m.content.slice(0, 80),
        lastAt: m.createdAt.toISOString(),
        totalMessages: 0,
        reportedMessages: 0,
      });
    }
    const entry = pairMap.get(key)!;
    entry.totalMessages++;
    if (m.isReported) entry.reportedMessages++;
  }

  const pairs = Array.from(pairMap.values());
  if (pairs.length === 0) { res.json([]); return; }

  const allUserIds = [...new Set(pairs.flatMap((p) => [p.user1Id, p.user2Id]))];
  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.id, allUserIds));

  const userMap = new Map(users.map((u) => [u.id, u]));

  const result = pairs
    .map((p) => ({
      ...p,
      user1: userMap.get(p.user1Id) ?? null,
      user2: userMap.get(p.user2Id) ?? null,
    }))
    .filter((p) => {
      const r1 = p.user1?.role;
      const r2 = p.user2?.role;
      if (!isSupportedDmPair(r1, r2)) return false;
      // Admin: only student↔student conversations visible
      // Super admin: all supported conversations
      if (auth.role === "super_admin") return true;
      return r1 === "student" && r2 === "student";
    });

  res.json(result);
});

/* ── GET /api/dm/admin/history/:user1Id/:user2Id ───────────────
   Admin: can view student↔student history only.
   Super admin: can view any supported pair.
───────────────────────────────────────────────────────────────── */
router.get("/dm/admin/history/:user1Id/:user2Id", async (req, res): Promise<void> => {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  const user1Id = parseInt(req.params.user1Id, 10);
  const user2Id = parseInt(req.params.user2Id, 10);
  if (isNaN(user1Id) || isNaN(user2Id)) { res.status(400).json({ error: "Invalid user IDs" }); return; }

  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.id, [user1Id, user2Id]));

  const userMap = new Map(users.map((u) => [u.id, u]));
  const u1 = userMap.get(user1Id);
  const u2 = userMap.get(user2Id);

  if (!isSupportedDmPair(u1?.role, u2?.role)) {
    res.status(404).json({ error: "Conversation not available for moderation" });
    return;
  }

  // Admin cannot view admin↔admin conversations
  if (auth.role !== "super_admin") {
    if (u1?.role !== "student" || u2?.role !== "student") {
      res.status(403).json({ error: "Admins can only view student-to-student conversations" });
      return;
    }
  }

  const messages = await db
    .select()
    .from(directMessagesTable)
    .where(
      or(
        and(eq(directMessagesTable.senderId, user1Id), eq(directMessagesTable.receiverId, user2Id)),
        and(eq(directMessagesTable.senderId, user2Id), eq(directMessagesTable.receiverId, user1Id)),
      ),
    )
    .orderBy(directMessagesTable.createdAt);

  res.json({
    user1: u1 ?? null,
    user2: u2 ?? null,
    messages,
  });
});

/* ── GET /api/dm/admin/reported ────────────────────────────────
   Admin: reported messages from student conversations only.
   Super admin: all reported messages for supported DM pairs.
───────────────────────────────────────────────────────────────── */
router.get("/dm/admin/reported", async (req, res): Promise<void> => {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  const messages = await db
    .select()
    .from(directMessagesTable)
    .where(eq(directMessagesTable.isReported, true))
    .orderBy(desc(directMessagesTable.reportedAt));

  if (messages.length === 0) { res.json([]); return; }

  const userIds = [...new Set(messages.flatMap((m) => [m.senderId, m.receiverId]))];
  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

  const userMap = new Map(users.map((u) => [u.id, u]));

  const result = messages
    .map((m) => ({
      ...m,
      sender: userMap.get(m.senderId) ?? null,
      receiver: userMap.get(m.receiverId) ?? null,
    }))
    .filter((m) => {
      if (!isSupportedDmPair(m.sender?.role, m.receiver?.role)) return false;
      if (auth.role === "super_admin") return true;
      // Admin: only student↔student reports
      return m.sender?.role === "student" && m.receiver?.role === "student";
    });

  res.json(result);
});

/* ── DELETE /api/dm/admin/message/:messageId ───────────────────
   Super admin only: permanently delete any message.
───────────────────────────────────────────────────────────────── */
router.delete("/dm/admin/message/:messageId", async (req, res): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;

  const messageId = parseInt(req.params.messageId, 10);
  if (isNaN(messageId)) { res.status(400).json({ error: "Invalid message ID" }); return; }

  const [msg] = await db.select({ id: directMessagesTable.id }).from(directMessagesTable).where(eq(directMessagesTable.id, messageId));
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  await db.delete(directMessagesTable).where(eq(directMessagesTable.id, messageId));
  res.json({ success: true });
});

export { router as dmRouter };
