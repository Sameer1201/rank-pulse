import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function requireSuperAdmin(req: any, res: any): boolean {
  const callerRole = req.cookies?.userRole;
  if (!callerRole) { res.status(401).json({ error: "Not authenticated" }); return false; }
  if (callerRole !== "super_admin") { res.status(403).json({ error: "Forbidden – super_admin only" }); return false; }
  return true;
}

const router: IRouter = Router();

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start, detail: "Cloudflare D1 connected" };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, detail: e?.message ?? "DB error" };
  }
}

async function checkFirebase(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return { ok: false, latencyMs: 0, detail: "FIREBASE_SERVICE_ACCOUNT_JSON not set" };

    const sa = JSON.parse(raw);
    const projectId = sa.project_id;
    if (!projectId) return { ok: false, latencyMs: 0, detail: "project_id missing in service account" };

    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");

    let app;
    const existing = getApps().find((a) => a.name === "health-check");
    if (existing) {
      app = existing;
    } else {
      app = initializeApp({ credential: cert(sa) }, "health-check");
    }

    await getAuth(app).listUsers(1);
    return { ok: true, latencyMs: Date.now() - start, detail: `Project: ${projectId}` };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, detail: e?.message ?? "Firebase error" };
  }
}

async function checkGmailSmtp(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  const user = (process.env.GMAIL_USER ?? process.env.SMTP_USER)?.trim();
  const pass = (process.env.GMAIL_APP_PASSWORD ?? process.env.SMTP_PASS)?.trim();
  if (!user || !pass) {
    return { ok: false, latencyMs: 0, detail: "SMTP_USER / SMTP_PASS not set" };
  }
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.verify();
    return { ok: true, latencyMs: Date.now() - start, detail: `Connected — ${user}` };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, detail: e?.message ?? "Gmail SMTP error" };
  }
}

async function checkRazorpay(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return { ok: false, latencyMs: 0, detail: "Razorpay keys not set" };

    const creds = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401) return { ok: false, latencyMs: Date.now() - start, detail: "Invalid credentials (401)" };
    if (!res.ok && res.status !== 400) {
      return { ok: false, latencyMs: Date.now() - start, detail: `HTTP ${res.status}` };
    }

    const mode = keyId.startsWith("rzp_live") ? "Live" : "Test";
    return { ok: true, latencyMs: Date.now() - start, detail: `Mode: ${mode} — Key: ${keyId}` };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, detail: e?.message ?? "Razorpay error" };
  }
}

router.get("/api/system-health", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const [dbResult, firebaseResult, gmailResult, razorpayResult] = await Promise.all([
    checkDatabase(),
    checkFirebase(),
    checkGmailSmtp(),
    checkRazorpay(),
  ]);

  const allOk = dbResult.ok && firebaseResult.ok && gmailResult.ok && razorpayResult.ok;

  res.json({
    status: allOk ? "healthy" : "degraded",
    checkedAt: new Date().toISOString(),
    services: {
      database:  { name: "Cloudflare D1 Database", ...dbResult },
      firebase:  { name: "Firebase (Auth + Admin)", ...firebaseResult },
      gmail:     { name: "Gmail SMTP (Email)", ...gmailResult },
      razorpay:  { name: "Razorpay (Payments)", ...razorpayResult },
    },
  });
});

export default router;
