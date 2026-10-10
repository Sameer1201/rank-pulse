import { renderRankPulseEmail } from "./rankPulseEmail";

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type WorkerPasswordResetEnv = {
  DB: { prepare(sql: string): Statement };
  PUBLIC_APP_URL?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
};

const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const GENERIC_MESSAGE = "If this account exists, a password reset link has been sent to its registered email. Check your inbox or Spam folder.";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

function readServiceAccount(env: WorkerPasswordResetEnv): ServiceAccount {
  let account: Record<string, unknown> = {};
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw new Error("Firebase service-account configuration is invalid."); }
    if (!account || typeof account !== "object") throw new Error("Firebase service-account configuration is invalid.");
  }
  const projectId = String(account.project_id ?? account.projectId ?? env.FIREBASE_PROJECT_ID ?? "").trim();
  const clientEmail = String(account.client_email ?? account.clientEmail ?? env.FIREBASE_CLIENT_EMAIL ?? "").trim();
  const privateKey = String(account.private_key ?? account.privateKey ?? env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase service-account credentials are not configured for Gmail password reset.");
  return { projectId, clientEmail, privateKey };
}

function base64Url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function generateResetUrl(account: ServiceAccount, email: string, publicUrl: string) {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: account.clientEmail, scope: "https://www.googleapis.com/auth/identitytoolkit", aud: OAUTH_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`;
  const pem = account.privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const tokenResponse = await fetch(OAUTH_URL, {
    method: "POST", signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
  });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error("Firebase service-account authorization failed.");

  // returnOobLink generates a Firebase one-use reset code without sending a Firebase email.
  // https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.access_token}` },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email, targetProjectId: account.projectId, returnOobLink: true }),
  });
  const payload = await response.json() as { oobLink?: string };
  if (!response.ok || !payload.oobLink) throw new Error("Firebase password reset link generation failed.");
  const firebaseUrl = new URL(payload.oobLink);
  if (!firebaseUrl.searchParams.get("oobCode")) throw new Error("Firebase returned an incomplete password reset link.");
  const resetUrl = new URL("/reset-password", publicUrl);
  for (const name of ["oobCode", "apiKey", "lang"]) {
    const value = firebaseUrl.searchParams.get(name);
    if (value) resetUrl.searchParams.set(name, value);
  }
  resetUrl.searchParams.set("mode", "resetPassword");
  return resetUrl.toString();
}

function escape(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export async function handleWorkerForgotPassword(
  request: Request,
  env: WorkerPasswordResetEnv,
  sendMail: (message: { to: string; subject: string; html: string }) => Promise<void>,
  corsHeaders: Record<string, string> = {},
) {
  const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => ({})) as Record<string, unknown> | null;
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier || identifier.length > 254) return reply({ error: "A valid email or username is required." }, 400);
  let account: ServiceAccount;
  try {
    if (!env.GMAIL_USER?.trim() || !env.GMAIL_APP_PASSWORD?.trim()) throw new Error("Gmail SMTP is not configured for password reset.");
    account = readServiceAccount(env);
    if (!env.PUBLIC_APP_URL?.trim()) throw new Error("PUBLIC_APP_URL is not configured for password reset.");
    const url = new URL(env.PUBLIC_APP_URL);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("PUBLIC_APP_URL must be an HTTP or HTTPS URL.");
  } catch (error) {
    console.error("Password reset configuration:", error instanceof Error ? error.message : "Invalid configuration");
    return reply({ error: "Password reset email is not configured yet. Please contact support." }, 503);
  }

  const user = await env.DB.prepare("SELECT id, full_name, email, last_password_reset_email_at FROM users WHERE (lower(username) = lower(?) OR lower(email) = lower(?)) AND role IN ('student', 'admin', 'super_admin') LIMIT 1")
    .bind(identifier, identifier).first<{ id: number; full_name: string; email: string; last_password_reset_email_at: number | null }>();
  if (!user?.email) return reply({ message: GENERIC_MESSAGE, delivery: "server" });
  const now = Date.now();
  // Reserve the cooldown atomically so concurrent requests cannot send duplicate emails.
  const claimed = await env.DB.prepare("UPDATE users SET last_password_reset_email_at = ? WHERE id = ? AND (last_password_reset_email_at IS NULL OR last_password_reset_email_at <= ?) RETURNING id")
    .bind(now, user.id, now - COOLDOWN_MS).first<{ id: number }>();
  if (!claimed) return reply({ message: `${GENERIC_MESSAGE} If you requested one recently, use that email; a new email can be requested after 2 hours.`, delivery: "server" });

  const subject = "Reset your RankPulse password";
  let sent = false;
  try {
    const resetUrl = await generateResetUrl(account, user.email, env.PUBLIC_APP_URL!);
    await sendMail({
      to: user.email, subject,
      html: renderRankPulseEmail({
        preheader: "Use the secure link to reset your RankPulse password.",
        eyebrow: "ACCOUNT SECURITY",
        title: "Reset your password",
        introHtml: `Hi ${escape(user.full_name)},<br>Use the secure button below to choose a new password for your RankPulse account.`,
        contentHtml: `<div style="padding:16px 18px;border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;font-size:13px;line-height:1.7;color:#7c4a03;">This link can be used once. If it has expired, request a new reset email. If you did not request this, ignore this email; your password will stay unchanged.</div>`,
        actionLabel: "Reset password →",
        actionUrl: escape(resetUrl),
        footerNote: "For your security, never share a password reset link.",
      }),
    });
    sent = true;
  } catch {
    // Do not persist provider responses, reset links, OAuth tokens or SMTP credentials in logs.
    await env.DB.prepare("UPDATE users SET last_password_reset_email_at = ? WHERE id = ? AND last_password_reset_email_at = ?")
      .bind(user.last_password_reset_email_at, user.id, now).run();
  }
  await env.DB.prepare("INSERT INTO email_send_logs (provider_key, provider_name, provider_source, sender_email, recipient_email, subject, message_type, status, error_message, metadata, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind("gmail-smtp-worker", "Gmail SMTP", "cloudflare-worker", env.GMAIL_USER!.trim(), user.email, subject, "password-reset", sent ? "sent" : "failed", sent ? null : "Password reset link generation or Gmail SMTP delivery failed.", JSON.stringify({ userId: user.id }), Date.now()).run()
    .catch(() => console.error("Password reset email log could not be saved."));
  return sent
    ? reply({ message: GENERIC_MESSAGE, delivery: "server" })
    : reply({ error: "Password reset email could not be sent. Please try again shortly." }, 503);
}
