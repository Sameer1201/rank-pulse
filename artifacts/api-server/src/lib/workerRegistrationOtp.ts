import { renderRankPulseEmail } from "./rankPulseEmail";

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number; last_row_id?: number } }>;
};

export type RegistrationOtpEnv = {
  DB: { prepare(sql: string): Statement };
  REGISTRATION_OTP_SECRET?: string;
  SESSION_SECRET?: string;
};

type OtpRow = {
  id: number;
  challenge_id: string;
  email: string;
  username: string;
  full_name: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  verified_at: number | null;
  consumed_at: number | null;
  last_sent_at: number;
};

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function secret(env: RegistrationOtpEnv) {
  const value = env.REGISTRATION_OTP_SECRET?.trim() || env.SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Registration OTP signing is not configured.");
  return value;
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(env: RegistrationOtpEnv, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function otpCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function registrationOtpTableSql() {
  return `CREATE TABLE IF NOT EXISTS registration_email_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    full_name TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER,
    consumed_at INTEGER,
    last_sent_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS registration_email_otps_email_idx ON registration_email_otps(email, created_at);`;
}

export async function createRegistrationOtpChallenge({
  env,
  email,
  username,
  fullName,
  sendEmail,
}: {
  env: RegistrationOtpEnv;
  email: string;
  username: string;
  fullName: string;
  sendEmail: (message: { to: string; subject: string; html: string }) => Promise<void>;
}) {
  const normalizedEmail = safeEmail(email);
  const normalizedUsername = safeText(username, 64);
  const normalizedFullName = safeText(fullName, 120);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT expires_at FROM registration_email_otps WHERE email = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1")
    .bind(normalizedEmail).first<{ expires_at: number }>();
  if (recent && Number(recent.expires_at) > now) {
    return { ok: false as const, status: 429, retryAfterSeconds: Math.ceil((Number(recent.expires_at) - now) / 1000) };
  }
  const code = otpCode();
  const challengeId = crypto.randomUUID();
  const expiresAt = now + OTP_TTL_MS;
  const codeHash = await digest(`${secret(env)}|${challengeId}|${normalizedEmail}|${code}`);
  await env.DB.prepare("INSERT INTO registration_email_otps (challenge_id, email, username, full_name, code_hash, expires_at, attempts, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
    .bind(challengeId, normalizedEmail, normalizedUsername, normalizedFullName, codeHash, expiresAt, now, now).run();
  try {
    await sendEmail({
      to: normalizedEmail,
      subject: "Your RankPulse verification code",
      html: renderRankPulseEmail({
        preheader: "Your RankPulse verification code is ready.",
        eyebrow: "EMAIL VERIFICATION",
        title: "Confirm your email",
        introHtml: `Hi ${escapeHtml(normalizedFullName)},<br>Use this one-time code to finish creating your RankPulse account.`,
        contentHtml: `<div style="padding:20px;border:1px solid #fed7aa;border-radius:16px;background:#fff7ed;text-align:center;"><div style="font-size:10px;font-weight:800;letter-spacing:1.5px;color:#9a5b10;">YOUR VERIFICATION CODE</div><div style="margin-top:12px;color:#c2410c;font-size:34px;line-height:1;font-weight:800;letter-spacing:10px;">${code}</div><div style="margin-top:14px;color:#64748b;font-size:12px;line-height:1.6;">Expires in 10 minutes · Up to ${MAX_ATTEMPTS} attempts</div></div><p style="margin:16px 0 0;color:#7b8494;font-size:12px;line-height:1.7;">If you did not request this code, ignore this email. Never share your verification code.</p>`,
        footerNote: "Complete your registration in the RankPulse app.",
      }),
    });
  } catch {
    await env.DB.prepare("DELETE FROM registration_email_otps WHERE challenge_id = ?").bind(challengeId).run().catch(() => undefined);
    throw new Error("Could not send verification code. Please try again.");
  }
  return { ok: true as const, challengeId, expiresAt, retryAfterSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyRegistrationOtp(env: RegistrationOtpEnv, challengeId: string, email: string, code: string) {
  const normalizedEmail = safeEmail(email);
  const normalizedCode = code.trim();
  const row = await env.DB.prepare("SELECT * FROM registration_email_otps WHERE challenge_id = ? AND email = ? LIMIT 1")
    .bind(challengeId.trim(), normalizedEmail).first<OtpRow>();
  if (!row || row.consumed_at || row.verified_at || Number(row.expires_at) <= Date.now()) return { ok: false as const, status: 400, error: "This verification code is invalid or expired." };
  if (Number(row.attempts) >= MAX_ATTEMPTS) return { ok: false as const, status: 429, error: "Too many incorrect codes. Request a new verification code." };
  const expected = await digest(`${secret(env)}|${row.challenge_id}|${normalizedEmail}|${normalizedCode}`);
  if (expected !== row.code_hash) {
    await env.DB.prepare("UPDATE registration_email_otps SET attempts = attempts + 1 WHERE id = ? AND verified_at IS NULL AND consumed_at IS NULL").bind(row.id).run();
    return { ok: false as const, status: 400, error: "Incorrect verification code." };
  }
  const verifiedAt = Date.now();
  await env.DB.prepare("UPDATE registration_email_otps SET verified_at = ? WHERE id = ? AND verified_at IS NULL AND consumed_at IS NULL").bind(verifiedAt, row.id).run();
  const proof = await signature(env, `registration-email|${row.challenge_id}|${normalizedEmail}|${verifiedAt}`);
  return { ok: true as const, proof, challengeId: row.challenge_id, expiresAt: row.expires_at };
}

export async function consumeRegistrationOtp(
  env: RegistrationOtpEnv,
  challengeId: string,
  email: string,
  proof: string,
  expectedDetails?: { username: string; fullName: string },
) {
  const normalizedEmail = safeEmail(email);
  const row = await env.DB.prepare("SELECT * FROM registration_email_otps WHERE challenge_id = ? AND email = ? LIMIT 1")
    .bind(challengeId.trim(), normalizedEmail).first<OtpRow>();
  if (!row || !row.verified_at || row.consumed_at || Number(row.expires_at) <= Date.now()) return { ok: false as const, error: "Email verification is required before registration." };
  if (expectedDetails && (row.username !== safeText(expectedDetails.username, 64) || row.full_name !== safeText(expectedDetails.fullName, 120))) {
    return { ok: false as const, error: "Registration details changed. Please request a new verification code." };
  }
  const expected = await signature(env, `registration-email|${row.challenge_id}|${normalizedEmail}|${row.verified_at}`);
  if (expected !== proof) return { ok: false as const, error: "Email verification is invalid. Please verify again." };
  const result = await env.DB.prepare("UPDATE registration_email_otps SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND verified_at IS NOT NULL").bind(Date.now(), row.id).run();
  if (!Number(result.meta?.changes ?? 0)) return { ok: false as const, error: "Email verification was already used." };
  return { ok: true as const, row };
}
