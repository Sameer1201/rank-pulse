import { createHmac, timingSafeEqual } from "node:crypto";
import { readPublicAppUrl } from "./publicAppUrl";

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export const PASSWORD_RESET_EMAIL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

function readPasswordResetSigningSecret() {
  const secret = readTrimmedString(process.env.PASSWORD_RESET_LINK_SECRET)
    || readTrimmedString(process.env.FIREBASE_PRIVATE_KEY)
    || readTrimmedString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    || readTrimmedString(process.env.BREVO_API_KEY)
    || readTrimmedString(process.env.SESSION_SECRET);
  if (!secret || secret.length < 32) throw new Error('Configure a strong PASSWORD_RESET_LINK_SECRET before issuing signed reset links.');
  return secret;
}

function signPasswordResetLink(oobCode: string, expiresAt: number) {
  return createHmac("sha256", readPasswordResetSigningSecret())
    .update(`${oobCode}:${expiresAt}`)
    .digest("hex");
}

export function buildCustomPasswordResetUrl(firebaseLink: string) {
  const firebaseUrl = new URL(firebaseLink);
  const appUrl = new URL("/reset-password", readPublicAppUrl());
  const expiresAt = Date.now() + PASSWORD_RESET_EMAIL_COOLDOWN_MS;
  const oobCode = firebaseUrl.searchParams.get("oobCode") ?? "";
  const sig = signPasswordResetLink(oobCode, expiresAt);

  ["oobCode", "mode", "apiKey", "lang", "continueUrl"].forEach((key) => {
    const value = firebaseUrl.searchParams.get(key);
    if (value) appUrl.searchParams.set(key, value);
  });

  appUrl.searchParams.set("expiresAt", String(expiresAt));
  appUrl.searchParams.set("sig", sig);

  return appUrl.toString();
}

export function isPasswordResetLinkSignatureValid(oobCode: string, expiresAt: number, sig: string) {
  if (!oobCode || !Number.isFinite(expiresAt) || !sig) return false;
  const expected = signPasswordResetLink(oobCode, expiresAt);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(sig, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function getPasswordResetCooldownRemaining(lastSentAt: Date | null | undefined) {
  if (!lastSentAt) return 0;
  const elapsed = Date.now() - lastSentAt.getTime();
  return Math.max(0, PASSWORD_RESET_EMAIL_COOLDOWN_MS - elapsed);
}

export function formatPasswordResetCooldown(remainingMs: number) {
  const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
