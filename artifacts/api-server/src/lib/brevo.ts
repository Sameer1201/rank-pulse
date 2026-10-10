import { and, desc, eq, sql } from "drizzle-orm";
import { db, emailProviderDailyUsageTable } from "@workspace/db";
import { emailSendLogsTable } from "@workspace/db/schema";
import { logger } from "./logger";
import {
  buildStudentReviewActionUrl,
  type StudentReviewRecipient,
  type StudentReviewSummary,
} from "./studentReview";
import { buildPublicAppUrl, readPublicAppUrl } from "./publicAppUrl";
import nodemailer from "nodemailer";
import { ensureRankPulseEmailLayout, renderRankPulseEmail } from "./rankPulseEmail";

const PENDING_STUDENT_ESCALATION_EMAIL = "Rankpulsee@gmail.com";
const GMAIL_SENDER_NAME = "Rank Pulse";

type BrevoEmailPayload = {
  to: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  messageType?: string;
  metadata?: Record<string, unknown> | null;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    cid?: string;
    contentType?: string;
  }>;
};

type BrevoAccountConfig = {
  id: number | null;
  key: string;
  providerName: string;
  apiKey: string;
  senderEmail: string;
  senderName: string;
  dailyLimit: number;
  source: "environment" | "database";
  isActive: boolean;
};

type StudentTestResultSubjectBreakdown = {
  label: string;
  totalQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  unattemptedQuestions: number;
  accuracyPct: number;
};

type StudentTestResultEmailArgs = {
  studentName: string;
  email: string;
  testId: number;
  testTitle: string;
  score: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
  passingScore?: number | null;
  submittedAt: Date | string | null;
  totalQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  unattemptedQuestions: number;
  timeSpentSeconds?: number | null;
  subjectBreakdown: StudentTestResultSubjectBreakdown[];
};

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function maskApiKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

const GMAIL_PROVIDER_KEY = "gmail-smtp";

function buildUsageDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInlineStudentAvatar(avatarUrl: string | null, studentId: number) {
  const source = avatarUrl?.trim() || "";
  if (!source.toLowerCase().startsWith("data:image/")) {
    return { src: source, attachment: undefined };
  }

  const match = source.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) {
    return { src: "", attachment: undefined };
  }

  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1];
  const cid = `student-avatar-${studentId}@rankpulse`;
  return {
    src: `cid:${cid}`,
    attachment: {
      filename: `student-${studentId}-avatar.${extension}`,
      content: Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64"),
      cid,
      contentType,
    },
  };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatMetricNumber(value: number, maximumFractionDigits = 2) {
  const numeric = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  }).format(numeric);
}

function formatPercentLabel(value: number) {
  return `${formatMetricNumber(clampPercent(value), 2)}%`;
}

function formatDurationLabel(totalSeconds: number | null | undefined) {
  const normalized = Math.round(Number(totalSeconds) || 0);
  if (normalized <= 0) return "Not captured";
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function isBrevoConfigured() {
  return isGmailSmtpConfigured();
}

export async function hasBrevoAccounts() {
  return isGmailSmtpConfigured();
}

export function isResendConfigured() {
  return isGmailSmtpConfigured();
}

export function isSendPulseConfigured() {
  return isGmailSmtpConfigured();
}

function getGmailSmtpConfig() {
  const user = readTrimmedEnv("GMAIL_USER") || readTrimmedEnv("SMTP_USER");
  const pass = readTrimmedEnv("GMAIL_APP_PASSWORD") || readTrimmedEnv("SMTP_PASS");
  if (!user || !pass) return null;
  return { user, pass };
}

export function isGmailSmtpConfigured() {
  return getGmailSmtpConfig() !== null;
}

async function sendViaGmailSmtp(payload: BrevoEmailPayload) {
  const config = getGmailSmtpConfig();
  if (!config) throw new Error("Gmail SMTP is not configured. Set SMTP_USER and SMTP_PASS.");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
  });

  await transporter.sendMail({
    from: `"${GMAIL_SENDER_NAME}" <${config.user}>`,
    to: payload.to,
    subject: payload.subject,
    html: payload.htmlContent,
    text: payload.textContent,
    attachments: payload.attachments,
  });

  logger.info({ recipient: payload.to, messageType: payload.messageType }, "Gmail SMTP email sent");
}

async function incrementDailyUsage(providerKey: string, usageDate: string) {
  const now = new Date();
  await db
    .insert(emailProviderDailyUsageTable)
    .values({
      providerKey,
      usageDate,
      sentCount: 1,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [emailProviderDailyUsageTable.providerKey, emailProviderDailyUsageTable.usageDate],
      set: {
        sentCount: sql`${emailProviderDailyUsageTable.sentCount} + 1`,
        lastSentAt: now,
        updatedAt: now,
      },
    });
}

function serializeLogMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

async function insertEmailSendLog({
  account,
  payload,
  status,
  errorMessage,
}: {
  account: BrevoAccountConfig;
  payload: BrevoEmailPayload;
  status: "sent" | "failed";
  errorMessage?: string;
}) {
  await db.insert(emailSendLogsTable).values({
    providerKey: account.key,
    providerName: account.providerName,
    providerSource: account.source,
    senderEmail: account.senderEmail,
    recipientEmail: payload.to,
    subject: payload.subject,
    messageType: payload.messageType?.trim() || "transactional",
    status,
    errorMessage: errorMessage?.trim() || null,
    metadata: serializeLogMetadata(payload.metadata),
    sentAt: new Date(),
  });
}

async function sendBrevoEmail(payload: BrevoEmailPayload) {
  payload = {
    ...payload,
    htmlContent: ensureRankPulseEmailLayout(payload.htmlContent, payload.subject, payload.messageType),
  };
  const usageDate = buildUsageDateKey();

  // ── Gmail SMTP (sole provider) ────────────────────────────────────────────
  const gmailConfig = getGmailSmtpConfig();
  if (!gmailConfig) {
    throw new Error("No email provider is configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.");
  }

  const usageRows = await db
    .select({ sentCount: emailProviderDailyUsageTable.sentCount, lastSentAt: emailProviderDailyUsageTable.lastSentAt })
    .from(emailProviderDailyUsageTable)
    .where(
      and(
        eq(emailProviderDailyUsageTable.providerKey, GMAIL_PROVIDER_KEY),
        eq(emailProviderDailyUsageTable.usageDate, usageDate),
      ),
    );
  const usage = usageRows[0] ?? { sentCount: 0, lastSentAt: null };

  const gmailAccount: BrevoAccountConfig = {
    id: null,
    key: GMAIL_PROVIDER_KEY,
    providerName: "Gmail SMTP",
    apiKey: gmailConfig.user,
    senderEmail: gmailConfig.user,
    senderName: GMAIL_SENDER_NAME,
    dailyLimit: 500,
    source: "environment",
    isActive: true,
  };

  try {
    await sendViaGmailSmtp(payload);
    await incrementDailyUsage(GMAIL_PROVIDER_KEY, usageDate);
    await insertEmailSendLog({ account: gmailAccount, payload, status: "sent" });
    logger.info({ recipient: payload.to, usedToday: usage.sentCount + 1 }, "Gmail SMTP email sent");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await insertEmailSendLog({ account: gmailAccount, payload, status: "failed", errorMessage }).catch(() => {});
    logger.error({ error, recipient: payload.to }, "Gmail SMTP send failed");
    throw error;
  }
}

export async function getBrevoProviderUsageSummary() {
  const usageDate = buildUsageDateKey();
  const providers: Array<{
    id: number | null;
    key: string;
    providerName: string;
    providerSource: string;
    senderEmail: string;
    senderName: string;
    dailyLimit: number;
    usedToday: number;
    remainingDaily: number;
    lastSentAt: string | null;
    status: string;
    routingRole: string;
    maskedApiKey: string;
    isActive: boolean;
  }> = [];

  // ── Gmail SMTP ────────────────────────────────────────────────────────────
  if (isGmailSmtpConfigured()) {
    const config = getGmailSmtpConfig()!;
    const usageRows = await db
      .select({ sentCount: emailProviderDailyUsageTable.sentCount, lastSentAt: emailProviderDailyUsageTable.lastSentAt })
      .from(emailProviderDailyUsageTable)
      .where(
        and(
          eq(emailProviderDailyUsageTable.providerKey, GMAIL_PROVIDER_KEY),
          eq(emailProviderDailyUsageTable.usageDate, usageDate),
        ),
      );
    const usage = usageRows[0] ?? { sentCount: 0, lastSentAt: null };
    const dailyLimit = 500;
    const remainingDaily = Math.max(0, dailyLimit - usage.sentCount);
    providers.push({
      id: null,
      key: GMAIL_PROVIDER_KEY,
      providerName: "Gmail SMTP",
      providerSource: "environment",
      senderEmail: config.user,
      senderName: GMAIL_SENDER_NAME,
      dailyLimit,
      usedToday: usage.sentCount,
      remainingDaily,
      lastSentAt: usage.lastSentAt?.toISOString() ?? null,
      status: usage.sentCount >= dailyLimit ? "limit-reached" : "active",
      routingRole: "primary",
      maskedApiKey: maskApiKey(config.user),
      isActive: true,
    });
  }

  return {
    usageDate,
    totals: {
      configuredProviders: providers.length,
      totalUsedToday: providers.reduce((sum, p) => sum + p.usedToday, 0),
      totalRemainingDaily: providers.reduce((sum, p) => sum + p.remainingDaily, 0),
    },
    providers,
  };
}

export async function listBrevoEmailSendLogs(limit = 50) {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const rows = await db
    .select()
    .from(emailSendLogsTable)
    .orderBy(desc(emailSendLogsTable.sentAt), desc(emailSendLogsTable.id))
    .limit(safeLimit);

  return rows.map((row) => ({
    id: row.id,
    providerKey: row.providerKey,
    providerName: row.providerName,
    providerSource: row.providerSource,
    providerMaskedApiKey: maskApiKey(
      row.providerKey === GMAIL_PROVIDER_KEY ? (getGmailSmtpConfig()?.user ?? "") : "",
    ),
    senderEmail: row.senderEmail,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    messageType: row.messageType,
    status: row.status,
    errorMessage: row.errorMessage,
    metadata: row.metadata,
    sentAt: row.sentAt?.toISOString() ?? null,
  }));
}

function readPortalUrl() {
  return readPublicAppUrl();
}

function buildPortalUrl(path: string) {
  return buildPublicAppUrl(path);
}

function buildStudentTestAnalysisUrl(testId: number) {
  return buildPortalUrl(`/student/tests/${testId}/analysis`);
}

export async function sendTestEmail({ to }: { to: string }) {
  const subject = "Rank Pulse — Email Test";
  const now = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
  const textContent = [
    "Hi,",
    "",
    "This is a test email from Rank Pulse to confirm that email delivery is working correctly.",
    "",
    `Sent at: ${now} (IST)`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid #fed7aa;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#f59e0b;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Email Test
          </div>
          <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;color:#111827;">Email delivery working ✓</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            This is a test email from <strong>Rank Pulse</strong> to confirm your email provider is configured correctly.
          </p>
        </div>
        <div style="padding:28px;">
          <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">
            Sent at: <strong>${now} (IST)</strong>
          </p>
          <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">
            You received this because a super admin triggered a test from the Rank Pulse dashboard.
          </p>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to,
    subject,
    htmlContent,
    textContent,
    messageType: "email-test",
    metadata: { triggeredAt: new Date().toISOString() },
  });
}

export async function sendStudentApprovedEmail({
  studentName,
  email,
}: {
  studentName: string;
  email: string;
}) {
  const safeName = escapeHtml(studentName.trim() || "Student");
  const portalUrl = readPortalUrl();
  const safePortalUrl = escapeHtml(portalUrl);

  const subject = "Your Rank Pulse application has been verified";
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    "Your Rank Pulse application has been verified.",
    "Your student portal is now active and you can log in to continue your preparation.",
    "",
    `Open portal: ${portalUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = renderRankPulseEmail({
    preheader: `Your RankPulse account is approved, ${safeName}.`,
    eyebrow: "PROFILE APPROVED",
    title: `Welcome to Rank Pulse, ${safeName}!`,
    introHtml: "Your student profile has been verified. Your learning workspace is ready; sign in to continue preparing and track your progress.",
    contentHtml: `<div style="padding:18px;border:1px solid #d1fae5;border-left:4px solid #10b981;border-radius:14px;background:#f0fdf8;color:#355b4b;font-size:14px;line-height:1.75;">Your next step: sign in with the account you registered and open your student dashboard.</div>`,
    actionLabel: "Open my dashboard →",
    actionUrl: safePortalUrl,
    footerNote: "Your student account is now active.",
  });

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-approved",
    metadata: { studentName },
  });
}

export async function sendStudentRejectedEmail({
  studentName,
  email,
  reason,
}: {
  studentName: string;
  email: string;
  reason: string;
}) {
  const safeName = escapeHtml(studentName.trim() || "Student");
  const safeReason = escapeHtml(reason.trim());
  const portalUrl = buildPortalUrl("/student/profile");
  const safePortalUrl = escapeHtml(portalUrl);

  const subject = "Your Rank Pulse application needs an update";
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    "Your Rank Pulse application was reviewed and is currently rejected.",
    "Reason:",
    reason,
    "",
    "Please log back in, update your details, and resubmit your profile for review.",
    `Open portal: ${portalUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = renderRankPulseEmail({
    preheader: `Your Rank Pulse application needs an update, ${safeName}.`,
    eyebrow: "PROFILE REVIEW",
    title: `A quick profile update, ${safeName}`,
    introHtml: "Your student profile has been reviewed. Please make the update below, then resubmit it for review.",
    contentHtml: `<div style="padding:20px 22px;border:1px solid #fecaca;border-left:5px solid #ef4444;border-radius:14px;background:#fff7f7;"><div style="font-size:10px;font-weight:800;letter-spacing:1.3px;color:#b91c1c;text-transform:uppercase;">Reviewer’s note</div><p style="margin:10px 0 0;font-size:15px;line-height:1.8;color:#44252a;white-space:pre-wrap;">${safeReason || "Please review and update your submitted profile details."}</p></div><p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:#58657a;">Update your details using this note as a guide, then resubmit the profile. It will return to the review queue.</p>`,
    actionLabel: "Update my profile →",
    actionUrl: safePortalUrl,
    footerNote: "This is an automated update about your student profile.",
  });

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-rejected",
    metadata: { studentName, reason },
  });
}

export async function sendPasswordResetEmail({
  accountName,
  email,
  resetUrl,
}: {
  accountName: string;
  email: string;
  resetUrl: string;
}) {
  const safeName = escapeHtml(accountName.trim() || "User");
  const safeResetUrl = escapeHtml(resetUrl);

  const subject = "Reset your Rank Pulse password";
  const textContent = [
    `Hi ${accountName || "User"},`,
    "",
    "We received a request to reset your Rank Pulse password.",
    `Reset password: ${resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = renderRankPulseEmail({
    preheader: `Your password reset link is ready, ${safeName}.`,
    eyebrow: "ACCOUNT SECURITY",
    title: `Reset your password, ${safeName}`,
    introHtml: "We received a request to reset your Rank Pulse password. Use the secure link below to choose a new one.",
    contentHtml: `<div style="padding:16px 18px;border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;font-size:13px;line-height:1.7;color:#7c4a03;">If you did not request this reset, ignore this email. Your password will stay unchanged.</div>`,
    actionLabel: "Set a new password →",
    actionUrl: safeResetUrl,
    footerNote: "For your security, never share a password reset link.",
  });

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "password-reset",
    metadata: { accountName },
  });
}

export async function sendPasswordChangedEmail({
  accountName,
  email,
  username,
  roleLabel,
}: {
  accountName: string;
  email: string;
  username: string;
  roleLabel?: string | null;
}) {
  const safeName = escapeHtml(accountName.trim() || "User");
  const safeEmail = escapeHtml(email.trim());
  const safeUsername = escapeHtml(username.trim());
  const safeRoleLabel = escapeHtml(roleLabel?.trim() || "account");
  const loginUrl = buildPortalUrl("/login");
  const safeLoginUrl = escapeHtml(loginUrl);

  const subject = "Your Rank Pulse password has been updated";
  const textContent = [
    `Hi ${accountName || "User"},`,
    "",
    `Your Rank Pulse ${roleLabel?.trim() || "account"} password was changed successfully.`,
    "",
    `Username: ${username}`,
    `Registered email: ${email}`,
    "",
    "You can now sign in with your new password.",
    `Login: ${loginUrl}`,
    "",
    "If you did not make this change, reset your password again immediately and contact support.",
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = renderRankPulseEmail({
    preheader: `Your RankPulse password was changed, ${safeName}.`,
    eyebrow: "SECURITY NOTICE",
    title: "Your password has been updated",
    introHtml: `Hi ${safeName}, your ${safeRoleLabel} password was changed successfully.`,
    contentHtml: `<div style="padding:17px 18px;border:1px solid #e6eaf1;border-radius:14px;background:#fbfcfe;font-size:13px;line-height:1.8;color:#435067;"><strong>Username:</strong> ${safeUsername}<br><strong>Registered email:</strong> ${safeEmail}</div><div style="margin-top:12px;padding:15px 17px;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:12px;background:#fff7f7;color:#7f1d1d;font-size:13px;line-height:1.7;">If you did not make this change, reset your password immediately and contact support.</div>`,
    actionLabel: "Sign in →",
    actionUrl: safeLoginUrl,
    footerNote: "This is an automated account security notification.",
  });

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "password-changed",
    metadata: { accountName, username, roleLabel: roleLabel?.trim() || "account" },
  });
}

export async function sendTeacherWelcomeEmail({
  teacherName,
  email,
  username,
  password,
  subject,
}: {
  teacherName: string;
  email: string;
  username: string;
  password: string;
  subject?: string | null;
}) {
  const safeTeacherName = escapeHtml(teacherName.trim() || "Teacher");
  const safeUsername = escapeHtml(username.trim());
  const safeEmail = escapeHtml(email.trim());
  const safePassword = escapeHtml(password);
  const safeSubject = escapeHtml(subject?.trim() || "Not assigned yet");
  const portalUrl = readPortalUrl();
  const safePortalUrl = escapeHtml(portalUrl);

  const mailSubject = "Your Rank Pulse teacher account is ready";
  const textContent = [
    `Hi ${teacherName || "Teacher"},`,
    "",
    "A teacher account has been created for you on Rank Pulse.",
    `Email:    ${email}`,
    `Username: ${username}`,
    `Password: ${password}`,
    `Subject:  ${subject?.trim() || "Not assigned yet"}`,
    "",
    `Sign in here: ${portalUrl}`,
    "",
    "Please change your password after your first login.",
    "If you were not expecting this account, please contact your administrator.",
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Rank Pulse Teacher Account</title></head>
<body style="margin:0;padding:0;background:#07040f;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🎓 ${safeTeacherName} — your Rank Pulse teacher account is ready. Credentials inside!</div>
<div style="max-width:580px;margin:0 auto;padding:16px 12px 32px;">

  <!-- HERO -->
  <div style="background:linear-gradient(160deg,#0d0521 0%,#2e1065 50%,#7c3aed 100%);border-radius:24px 24px 0 0;padding:52px 32px 44px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:14px;left:22px;width:3px;height:3px;background:#c4b5fd;border-radius:50%;opacity:.7;"></div>
    <div style="position:absolute;top:30px;right:44px;width:2px;height:2px;background:#ddd6fe;border-radius:50%;opacity:.6;"></div>
    <div style="position:absolute;bottom:26px;left:55px;width:2px;height:2px;background:#c4b5fd;border-radius:50%;opacity:.5;"></div>
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 0%,rgba(124,58,237,.14) 0%,transparent 70%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(167,139,250,.15);border:1px solid rgba(196,181,253,.35);border-radius:999px;padding:6px 20px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#c4b5fd;margin-bottom:22px;">🎓 Teacher Account</div>
      <div style="font-size:60px;margin-bottom:14px;">👩‍🏫</div>
      <h1 style="margin:0 0 10px;font-size:30px;font-weight:900;color:#fff;line-height:1.1;">Welcome, ${safeTeacherName}!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.65);line-height:1.6;max-width:400px;">Your Rank Pulse teacher account is ready. Use the credentials below to sign in and start managing your students.</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#0f0a1e;border-left:1px solid rgba(124,58,237,.12);border-right:1px solid rgba(124,58,237,.12);">

    <!-- Credentials card -->
    <div style="padding:32px 24px 24px;">
      <div style="background:rgba(124,58,237,.08);border:2px solid rgba(124,58,237,.25);border-radius:18px;padding:24px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a78bfa;margin-bottom:18px;">🔑 Your Login Credentials</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.08em;width:90px;">Email</td>
                <td style="font-size:14px;color:#e9d5ff;font-family:monospace;">${safeEmail}</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.08em;width:90px;">Username</td>
                <td style="font-size:14px;color:#e9d5ff;font-family:monospace;font-weight:700;">${safeUsername}</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.08em;width:90px;">Password</td>
                <td><span style="display:inline-block;font-family:monospace;font-size:15px;font-weight:800;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:4px 12px;color:#fcd34d;letter-spacing:.06em;">${safePassword}</span></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.08em;width:90px;">Subject</td>
                <td style="font-size:14px;color:rgba(255,255,255,.6);">${safeSubject}</td>
              </tr></table>
            </td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Change password notice -->
    <div style="padding:0 24px 24px;">
      <div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.18);border-left:4px solid #f59e0b;border-radius:0 14px 14px 0;padding:14px 20px;">
        <p style="margin:0;font-size:13px;line-height:1.7;color:rgba(255,255,255,.65);">🔐 <strong style="color:#fcd34d;">Please change your password</strong> after your first login for account security.</p>
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 40px;text-align:center;">
      <a href="${safePortalUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;text-decoration:none;padding:18px 52px;border-radius:16px;font-size:17px;font-weight:800;box-shadow:0 8px 28px rgba(124,58,237,.45);">🎓 Open Teacher Portal →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">If you weren't expecting this, contact your administrator</p>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#07040f;padding:20px 24px;text-align:center;border-radius:0 0 24px 24px;border:1px solid rgba(124,58,237,.08);border-top:none;">
    <span style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:999px;padding:4px 16px;font-size:11px;font-weight:900;color:#fff;letter-spacing:.1em;">RANK PULSE</span>
    <p style="margin:10px 0 0;font-size:11px;color:rgba(255,255,255,.18);">This is an automated notification from your platform administrator.</p>
  </div>

</div></body></html>`.trim();

  await sendBrevoEmail({
    to: email,
    subject: mailSubject,
    htmlContent,
    textContent,
    messageType: "teacher-welcome",
    metadata: { teacherName, username, subject: subject?.trim() || null },
  });
}

export async function sendStudentTestResultEmail({
  studentName,
  email,
  testId,
  testTitle,
  score,
  totalPoints,
  percentage,
  passed,
  passingScore,
  submittedAt,
  totalQuestions,
  attemptedQuestions,
  correctQuestions,
  incorrectQuestions,
  unattemptedQuestions,
  timeSpentSeconds,
  subjectBreakdown,
}: StudentTestResultEmailArgs) {
  const safeStudentName = escapeHtml(studentName.trim() || "Student");
  const safeTestTitle = escapeHtml(testTitle.trim() || "Your test");
  const safeScore = escapeHtml(formatMetricNumber(score, 2));
  const safeTotalPoints = escapeHtml(formatMetricNumber(totalPoints, 2));
  const safePercentage = escapeHtml(formatPercentLabel(percentage));
  const safeAttemptedLabel = escapeHtml(`${attemptedQuestions}/${totalQuestions}`);
  const safeCorrectLabel = escapeHtml(String(correctQuestions));
  const safeIncorrectLabel = escapeHtml(String(incorrectQuestions));
  const safeUnattemptedLabel = escapeHtml(String(unattemptedQuestions));
  const safeTimeSpentLabel = escapeHtml(formatDurationLabel(timeSpentSeconds));
  const analysisUrl = buildStudentTestAnalysisUrl(testId);
  const safeAnalysisUrl = escapeHtml(analysisUrl);
  const submittedDate = submittedAt ? new Date(submittedAt) : null;
  const submittedLabel = submittedDate && !Number.isNaN(submittedDate.getTime())
    ? submittedDate.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "Just now";
  const safeSubmittedLabel = escapeHtml(submittedLabel);
  const scoreStatus = passed ? "Passed" : passingScore == null ? "Submitted" : "Keep going";
  const safeScoreStatus = escapeHtml(scoreStatus);
  const passingBenchmarkLabel = passingScore == null ? "Not set" : formatPercentLabel(passingScore);
  const safePassingBenchmarkLabel = escapeHtml(passingBenchmarkLabel);
  const correctPct = totalQuestions > 0 ? clampPercent((correctQuestions / totalQuestions) * 100) : 0;
  const incorrectPct = totalQuestions > 0 ? clampPercent((incorrectQuestions / totalQuestions) * 100) : 0;
  const unattemptedPct = totalQuestions > 0 ? clampPercent((unattemptedQuestions / totalQuestions) * 100) : 0;

  const subjectSummaryLines = subjectBreakdown.map((item) => (
    `${item.label}: ${item.correctQuestions}/${item.totalQuestions} correct (${formatPercentLabel(item.accuracyPct)})`
  ));

  const subjectRowsHtml = subjectBreakdown.length > 0
    ? subjectBreakdown.map((item) => {
        const safeLabel = escapeHtml(item.label);
        const safeCounts = escapeHtml(`${item.correctQuestions}/${item.totalQuestions} correct`);
        const safeAccuracy = escapeHtml(formatPercentLabel(item.accuracyPct));
        const safeAttempted = escapeHtml(`${item.attemptedQuestions}/${item.totalQuestions}`);
        const safeIncorrect = escapeHtml(String(item.incorrectQuestions));
        const safeUnattempted = escapeHtml(String(item.unattemptedQuestions));
        const accuracyWidth = clampPercent(item.accuracyPct);

        return `
          <tr>
            <td style="padding:0 0 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="font-size:14px;font-weight:700;color:#111827;padding-bottom:4px;">${safeLabel}</td>
                  <td align="right" style="font-size:12px;color:#4b5563;padding-bottom:4px;">${safeCounts} · ${safeAccuracy}</td>
                </tr>
              </table>
              <div style="margin-top:6px;background:#e5e7eb;border-radius:999px;height:10px;overflow:hidden;">
                <div style="width:${accuracyWidth}%;height:10px;background:linear-gradient(90deg,#2563eb 0%,#0ea5e9 100%);border-radius:999px;"></div>
              </div>
              <p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">
                Attempted ${safeAttempted} · Incorrect ${safeIncorrect} · Not attempted ${safeUnattempted}
              </p>
            </td>
          </tr>
        `.trim();
      }).join("")
    : `
      <tr>
        <td style="font-size:13px;line-height:1.7;color:#6b7280;">
          Subject-wise performance will appear once the test has mapped sections or subject labels.
        </td>
      </tr>
    `.trim();

  const subject = `Your Rank Pulse result is ready: ${testTitle}`;
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    `Your result for ${testTitle} is now ready.`,
    `Score: ${formatMetricNumber(score, 2)} / ${formatMetricNumber(totalPoints, 2)}`,
    `Score percentage: ${formatPercentLabel(percentage)}`,
    `Status: ${scoreStatus}`,
    `Passing benchmark: ${passingBenchmarkLabel}`,
    `Attempted: ${attemptedQuestions}/${totalQuestions}`,
    `Correct: ${correctQuestions}`,
    `Incorrect: ${incorrectQuestions}`,
    `Not attempted: ${unattemptedQuestions}`,
    `Time spent: ${formatDurationLabel(timeSpentSeconds)}`,
    `Submitted at: ${submittedLabel}`,
    "",
    "Subject performance:",
    ...subjectSummaryLines,
    "",
    `Open full analysis: ${analysisUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const heroGrad = passed
    ? "linear-gradient(160deg,#032917 0%,#064e3b 50%,#059669 100%)"
    : passingScore == null
      ? "linear-gradient(160deg,#0c1445 0%,#1e3a8a 55%,#2563eb 100%)"
      : "linear-gradient(160deg,#1a0000 0%,#7f1d1d 50%,#dc2626 100%)";
  const heroBorder = passed ? "rgba(16,185,129,.12)" : passingScore == null ? "rgba(59,130,246,.12)" : "rgba(239,68,68,.12)";
  const heroBg = passed ? "#0a1810" : passingScore == null ? "#0d1117" : "#110000";
  const heroAccent = passed ? "#10b981" : passingScore == null ? "#3b82f6" : "#ef4444";
  const heroAccentLight = passed ? "#6ee7b7" : passingScore == null ? "#93c5fd" : "#fca5a5";
  const scoreBadgeBg = passed ? "rgba(16,185,129,.18)" : passingScore == null ? "rgba(59,130,246,.18)" : "rgba(239,68,68,.18)";
  const scoreBadgeBorder = passed ? "rgba(52,211,153,.4)" : passingScore == null ? "rgba(96,165,250,.4)" : "rgba(239,68,68,.4)";
  const perfMsg = percentage >= 90
    ? "🏆 Absolutely outstanding! You're in the top tier."
    : percentage >= 75
      ? "🌟 Excellent work! You've cleared the benchmark with flying colors."
      : percentage >= 60
        ? "📈 Good effort! You're on the right track — keep pushing."
        : percentage >= 40
          ? "💪 Not bad! Focus on weak areas and you'll nail it next time."
          : "🎯 Use the analysis below to target your weak spots — every test teaches you something.";

  const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Result: ${safeTestTitle}</title></head>
<body style="margin:0;padding:0;background:#080c14;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${passed ? "✅" : "📊"} ${safeStudentName} — your result for ${safeTestTitle} is ready. Score: ${safeScore}/${safeTotalPoints} (${safePercentage})</div>
<div style="max-width:620px;margin:0 auto;padding:16px 12px 32px;">

  <!-- HERO: Score display -->
  <div style="background:${heroGrad};border-radius:24px 24px 0 0;padding:48px 32px 40px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.06) 0%,transparent 70%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:${scoreBadgeBg};border:1px solid ${scoreBadgeBorder};border-radius:999px;padding:6px 22px;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${heroAccentLight};margin-bottom:20px;">${passed ? "✅ PASSED" : passingScore == null ? "📊 COMPLETED" : "📋 KEEP GOING"}</div>
      <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,.5);letter-spacing:.06em;margin-bottom:8px;text-transform:uppercase;">${safeTestTitle}</div>
      <div style="font-size:64px;font-weight:900;color:#fff;line-height:1;margin-bottom:4px;">${safePercentage}</div>
      <div style="font-size:18px;font-weight:700;color:rgba(255,255,255,.6);margin-bottom:16px;">${safeScore} out of ${safeTotalPoints} points</div>
      <div style="font-size:12px;color:rgba(255,255,255,.4);">Submitted: ${safeSubmittedLabel}</div>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:${heroBg};border-left:1px solid ${heroBorder};border-right:1px solid ${heroBorder};">

    <!-- 4 Quick stat cards -->
    <div style="padding:28px 24px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding:0 4px 0 0;width:25%;vertical-align:top;">
          <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:14px;padding:14px 6px;text-align:center;">
            <div style="font-size:18px;margin-bottom:4px;">📝</div>
            <div style="font-size:17px;font-weight:900;color:#6ee7b7;line-height:1;">${safeAttemptedLabel}</div>
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:4px;">Attempted</div>
          </div>
        </td>
        <td style="padding:0 2px;width:25%;vertical-align:top;">
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.18);border-radius:14px;padding:14px 6px;text-align:center;">
            <div style="font-size:18px;margin-bottom:4px;">✅</div>
            <div style="font-size:17px;font-weight:900;color:#4ade80;line-height:1;">${safeCorrectLabel}</div>
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:4px;">Correct</div>
          </div>
        </td>
        <td style="padding:0 2px;width:25%;vertical-align:top;">
          <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.18);border-radius:14px;padding:14px 6px;text-align:center;">
            <div style="font-size:18px;margin-bottom:4px;">❌</div>
            <div style="font-size:17px;font-weight:900;color:#f87171;line-height:1;">${safeIncorrectLabel}</div>
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:4px;">Wrong</div>
          </div>
        </td>
        <td style="padding:0 0 0 4px;width:25%;vertical-align:top;">
          <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.18);border-radius:14px;padding:14px 6px;text-align:center;">
            <div style="font-size:18px;margin-bottom:4px;">⏱️</div>
            <div style="font-size:15px;font-weight:900;color:#fbbf24;line-height:1;">${safeTimeSpentLabel}</div>
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:4px;">Time</div>
          </div>
        </td>
      </tr></table>
    </div>

    <!-- Answer distribution bar -->
    <div style="padding:0 24px 24px;">
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;"><tr>
          <td style="font-size:13px;font-weight:700;color:rgba(255,255,255,.8);">Answer Distribution</td>
          <td style="text-align:right;font-size:12px;color:rgba(255,255,255,.35);">Passing: ${safePassingBenchmarkLabel}</td>
        </tr></table>
        <div style="background:rgba(255,255,255,.06);border-radius:999px;height:16px;overflow:hidden;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="height:16px;border-collapse:collapse;"><tr>
            <td style="width:${correctPct}%;background:linear-gradient(90deg,#059669,#10b981);"></td>
            <td style="width:${incorrectPct}%;background:linear-gradient(90deg,#dc2626,#ef4444);"></td>
            <td style="width:${unattemptedPct}%;background:rgba(148,163,184,.25);"></td>
          </tr></table>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
          <td style="font-size:12px;color:rgba(255,255,255,.55);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;margin-right:6px;vertical-align:middle;"></span>Correct: ${safeCorrectLabel}</td>
          <td style="font-size:12px;color:rgba(255,255,255,.55);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-right:6px;vertical-align:middle;"></span>Wrong: ${safeIncorrectLabel}</td>
          <td style="font-size:12px;color:rgba(255,255,255,.55);"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(148,163,184,.5);margin-right:6px;vertical-align:middle;"></span>Skipped: ${safeUnattemptedLabel}</td>
        </tr></table>
      </div>
    </div>

    <!-- Performance insight -->
    <div style="padding:0 24px 24px;">
      <div style="background:rgba(${passed ? "16,185,129" : passingScore == null ? "59,130,246" : "245,158,11"},.07);border:1px solid rgba(${passed ? "52,211,153" : passingScore == null ? "96,165,250" : "245,158,11"},.18);border-left:4px solid ${heroAccent};border-radius:0 16px 16px 0;padding:16px 20px;">
        <p style="margin:0;font-size:14px;line-height:1.7;color:rgba(255,255,255,.8);">${perfMsg}</p>
      </div>
    </div>

    <!-- Subject breakdown -->
    ${subjectBreakdown.length > 0 ? `
    <div style="padding:0 24px 24px;">
      <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:18px;">📚 Subject Breakdown</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${subjectBreakdown.map((item) => {
            const sLabel = escapeHtml(item.label);
            const sAcc = Math.round(item.accuracyPct);
            const sColor = sAcc >= 75 ? "#10b981" : sAcc >= 50 ? "#f59e0b" : "#ef4444";
            const sGlow = sAcc >= 75 ? "#6ee7b7" : sAcc >= 50 ? "#fde68a" : "#fca5a5";
            return `<tr><td style="padding:0 0 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr>
                <td style="font-size:13px;font-weight:700;color:rgba(255,255,255,.8);">${sLabel}</td>
                <td style="text-align:right;font-size:13px;font-weight:800;color:${sColor};">${item.correctQuestions}/${item.totalQuestions} &nbsp;·&nbsp; ${sAcc}%</td>
              </tr></table>
              <div style="background:rgba(255,255,255,.06);border-radius:999px;height:10px;overflow:hidden;">
                <div style="width:${sAcc}%;height:10px;border-radius:999px;background:linear-gradient(90deg,${sColor},${sGlow});"></div>
              </div>
            </td></tr>`;
          }).join("")}
        </table>
      </div>
    </div>` : ""}

    <!-- CTA -->
    <div style="padding:0 24px 40px;text-align:center;">
      <a href="${safeAnalysisUrl}" style="display:inline-block;background:linear-gradient(135deg,${passed ? "#059669,#047857" : passingScore == null ? "#2563eb,#1d4ed8" : "#d97706,#b45309"});color:#fff;text-decoration:none;padding:18px 52px;border-radius:16px;font-size:17px;font-weight:800;box-shadow:0 8px 28px rgba(${passed ? "5,150,105" : passingScore == null ? "37,99,235" : "180,83,9"},.4);">📊 View Full Analysis →</a>
      <p style="margin:12px 0 4px;font-size:11px;color:rgba(255,255,255,.22);">Question-wise solutions, difficulty analysis, and next-step improvements</p>
      <p style="margin:8px 24px 0;font-size:11px;color:rgba(255,255,255,.15);word-break:break-all;">${safeAnalysisUrl}</p>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#080c14;padding:22px 24px;text-align:center;border-radius:0 0 24px 24px;border:1px solid rgba(255,255,255,.04);border-top:none;">
    <span style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:999px;padding:4px 16px;font-size:11px;font-weight:900;color:#fff;letter-spacing:.1em;">RANK PULSE</span>
    <p style="margin:10px 0 0;font-size:11px;color:rgba(255,255,255,.2);">You're receiving this because you completed a test on Rank Pulse.</p>
  </div>

</div></body></html>`.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-test-result",
    metadata: {
      testId,
      testTitle,
      percentage,
      passed,
      totalQuestions,
      attemptedQuestions,
      correctQuestions,
      incorrectQuestions,
      unattemptedQuestions,
    },
  });
}

type StudentQuestionReportAcknowledgementEmailArgs = {
  studentName: string;
  email: string;
  questionLabel: string;
  contextTitle: string;
  reason: string;
  actionUrl: string;
};

type TeacherQuestionReportAlertEmailArgs = {
  teacherName: string;
  email: string;
  studentName: string;
  questionLabel: string;
  contextTitle: string;
  reason: string;
  actionUrl: string;
};

type StudentQuestionReportRejectedEmailArgs = {
  studentName: string;
  email: string;
  questionLabel: string;
  contextTitle: string;
  actionUrl: string;
};

type StudentQuestionUpdatedEmailArgs = {
  studentName: string;
  email: string;
  questionLabel: string;
  contextTitle: string;
  actionUrl: string;
};

export async function sendStudentQuestionReportAcknowledgementEmail({
  studentName,
  email,
  questionLabel,
  contextTitle,
  reason,
  actionUrl,
}: StudentQuestionReportAcknowledgementEmailArgs) {
  const safeStudentName = escapeHtml(studentName.trim() || "Student");
  const safeQuestionLabel = escapeHtml(questionLabel.trim() || "the reported question");
  const safeContextTitle = escapeHtml(contextTitle.trim() || "your assessment");
  const safeReason = escapeHtml(reason.trim());
  const safeActionUrl = escapeHtml(actionUrl);

  const subject = `We received your report for ${contextTitle}`;
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    `We received your report for ${questionLabel} in ${contextTitle}.`,
    "Your teacher will review the issue and take the appropriate action.",
    "",
    "Reported reason:",
    reason,
    "",
    `Open page: ${actionUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid #fed7aa;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#d97706;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Report Received
          </div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">Your question report is in review</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            Hi ${safeStudentName}, we have received your report for <strong>${safeQuestionLabel}</strong> in <strong>${safeContextTitle}</strong>.
          </p>
        </div>
        <div style="padding:28px;">
          <div style="border:1px solid #fed7aa;border-radius:18px;background:#fffaf0;padding:18px 20px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#92400e;">
              Reported issue
            </p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
              ${safeReason}
            </p>
          </div>
          <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#374151;">
            The teacher who owns this question has been notified. Once the report is rejected or the question is updated, we will email you again.
          </p>
          <div style="margin-top:24px;">
            <a href="${safeActionUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
              Open Question
            </a>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-question-report-acknowledged",
    metadata: { questionLabel, contextTitle },
  });
}

export async function sendTeacherQuestionReportAlertEmail({
  teacherName,
  email,
  studentName,
  questionLabel,
  contextTitle,
  reason,
  actionUrl,
}: TeacherQuestionReportAlertEmailArgs) {
  const safeTeacherName = escapeHtml(teacherName.trim() || "Teacher");
  const safeStudentName = escapeHtml(studentName.trim() || "A student");
  const safeQuestionLabel = escapeHtml(questionLabel.trim() || "the reported question");
  const safeContextTitle = escapeHtml(contextTitle.trim() || "your assessment");
  const safeReason = escapeHtml(reason.trim());
  const safeActionUrl = escapeHtml(actionUrl);

  const subject = `Question reported in ${contextTitle}`;
  const textContent = [
    `Hi ${teacherName || "Teacher"},`,
    "",
    `${studentName || "A student"} reported ${questionLabel} in ${contextTitle}.`,
    "",
    "Reported reason:",
    reason,
    "",
    `Open review page: ${actionUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid #fed7aa;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#b91c1c;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Question Report
          </div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">A student reported one of your questions</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            Hi ${safeTeacherName}, <strong>${safeStudentName}</strong> reported <strong>${safeQuestionLabel}</strong> in <strong>${safeContextTitle}</strong>.
          </p>
        </div>
        <div style="padding:28px;">
          <div style="border:1px solid #fecaca;border-radius:18px;background:#fff5f5;padding:18px 20px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b91c1c;">
              Student note
            </p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#7f1d1d;">
              ${safeReason}
            </p>
          </div>
          <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#374151;">
            Please open the builder, review the question, and either update it or reject the report after review.
          </p>
          <div style="margin-top:24px;">
            <a href="${safeActionUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
              Open Builder
            </a>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "teacher-question-report-alert",
    metadata: { studentName, questionLabel, contextTitle },
  });
}

export async function sendStudentQuestionReportRejectedEmail({
  studentName,
  email,
  questionLabel,
  contextTitle,
  actionUrl,
}: StudentQuestionReportRejectedEmailArgs) {
  const safeStudentName = escapeHtml(studentName.trim() || "Student");
  const safeQuestionLabel = escapeHtml(questionLabel.trim() || "the reported question");
  const safeContextTitle = escapeHtml(contextTitle.trim() || "your assessment");
  const safeActionUrl = escapeHtml(actionUrl);

  const subject = `Your question report was reviewed for ${contextTitle}`;
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    `Your report for ${questionLabel} in ${contextTitle} was reviewed and rejected by the teacher.`,
    "No change was applied to the question at this time.",
    "",
    `Open page: ${actionUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid #fed7aa;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#9f1239;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Report Closed
          </div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">Your report was rejected after review</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            Hi ${safeStudentName}, the teacher reviewed your report for <strong>${safeQuestionLabel}</strong> in <strong>${safeContextTitle}</strong> and rejected it.
          </p>
        </div>
        <div style="padding:28px;">
          <div style="border:1px solid #fbcfe8;border-radius:18px;background:#fff1f2;padding:18px 20px;">
            <p style="margin:0;font-size:14px;line-height:1.7;color:#7f1d1d;">
              No update was made to the question based on this report.
            </p>
          </div>
          <div style="margin-top:24px;">
            <a href="${safeActionUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
              Open Question
            </a>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-question-report-rejected",
    metadata: { questionLabel, contextTitle },
  });
}

export async function sendStudentQuestionUpdatedEmail({
  studentName,
  email,
  questionLabel,
  contextTitle,
  actionUrl,
}: StudentQuestionUpdatedEmailArgs) {
  const safeStudentName = escapeHtml(studentName.trim() || "Student");
  const safeQuestionLabel = escapeHtml(questionLabel.trim() || "a reported question");
  const safeContextTitle = escapeHtml(contextTitle.trim() || "your exam");
  const safeActionUrl = escapeHtml(actionUrl);

  const subject = `Updated question available for ${contextTitle}`;
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    `${questionLabel} in ${contextTitle} has been updated by the teacher.`,
    "If you are preparing for this exam, please review the latest version in the portal.",
    "",
    `Open portal: ${actionUrl}`,
    "",
    "Team Rank Pulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid #fed7aa;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#16a34a;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Question Updated
          </div>
          <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">A question was updated for your exam</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            Hi ${safeStudentName}, <strong>${safeQuestionLabel}</strong> in <strong>${safeContextTitle}</strong> was updated after teacher review.
          </p>
        </div>
        <div style="padding:28px;">
          <div style="border:1px solid #bbf7d0;border-radius:18px;background:#f0fdf4;padding:18px 20px;">
            <p style="margin:0;font-size:14px;line-height:1.7;color:#166534;">
              Please check the latest version before your next attempt or review session.
            </p>
          </div>
          <div style="margin-top:24px;">
            <a href="${safeActionUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
              Open Portal
            </a>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-question-updated",
    metadata: { questionLabel, contextTitle },
  });
}

export async function sendPendingStudentReviewEscalationEmail({
  studentName,
  studentEmail,
  username,
  subject,
  reviewStartedAt,
}: {
  studentName: string;
  studentEmail: string;
  username: string;
  subject: string | null;
  reviewStartedAt: Date | string | null;
}) {
  const safeName = escapeHtml(studentName.trim() || "Student");
  const safeStudentEmail = escapeHtml(studentEmail.trim());
  const safeUsername = escapeHtml(username.trim());
  const safeSubject = escapeHtml(subject?.trim() || "Not selected");
  const reviewDate = reviewStartedAt ? new Date(reviewStartedAt) : null;
  const reviewStartedLabel = reviewDate && !Number.isNaN(reviewDate.getTime())
    ? reviewDate.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "Unknown";
  const safeReviewStartedLabel = escapeHtml(reviewStartedLabel);
  const portalUrl = readPortalUrl();
  const safePortalUrl = escapeHtml(portalUrl);

  const emailSubject = "⏰ Urgent: Student verification pending for 24+ hours — Action required";
  const textContent = [
    "Hi Sameer,",
    "",
    "ACTION REQUIRED: A student account has been pending verification for more than 24 hours.",
    "",
    `Student name: ${studentName || "Student"}`,
    `Student email: ${studentEmail}`,
    `Username: @${username}`,
    `Target exam: ${subject?.trim() || "Not selected"}`,
    `Review started: ${reviewStartedLabel}`,
    "",
    "Please open the Rank Pulse admin panel and take action on this student's application.",
    `Open admin panel: ${portalUrl}/super-admin/students`,
    "",
    "— Rank Pulse Automated Alert",
  ].join("\n");

  const htmlContent = `
    <div style="background:#0f172a;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1f2937;">
      <div style="max-width:580px;margin:0 auto;">

        <!-- Top urgency banner -->
        <div style="background:linear-gradient(135deg,#7c2d12 0%,#dc2626 50%,#b91c1c 100%);border-radius:20px 20px 0 0;padding:20px 28px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:8px;height:8px;border-radius:50%;background:#fbbf24;box-shadow:0 0 8px #fbbf24;animation:pulse 1s infinite;"></div>
            <span style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#fca5a5;">Urgent — Action Required</span>
          </div>
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;line-height:1.2;color:#ffffff;">Student waiting 24+ hours for review</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;color:#fca5a5;">
            Hi Sameer — this verification has not been actioned yet. Please review now.
          </p>
        </div>

        <!-- Main card -->
        <div style="background:#ffffff;border-radius:0 0 20px 20px;padding:28px;">

          <!-- Student profile block -->
          <div style="display:flex;align-items:center;gap:16px;padding:16px 20px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1px solid #fed7aa;border-radius:16px;margin-bottom:20px;">
            <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#f97316,#d97706);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#ffffff;flex-shrink:0;">
              ${escapeHtml(safeName.charAt(0).toUpperCase())}
            </div>
            <div>
              <p style="margin:0 0 2px;font-size:17px;font-weight:800;color:#111827;">${safeName}</p>
              <p style="margin:0;font-size:13px;color:#6b7280;">@${safeUsername} · ${safeStudentEmail}</p>
            </div>
          </div>

          <!-- Info table -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;width:140px;">Target Exam</td>
              <td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${safeSubject}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;">Review Started</td>
              <td style="padding:10px 0;font-size:14px;color:#374151;">${safeReviewStartedLabel}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;">Status</td>
              <td style="padding:10px 0;">
                <span style="display:inline-flex;align-items:center;gap:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;color:#dc2626;">
                  ⏰ Pending &gt; 24 hours
                </span>
              </td>
            </tr>
          </table>

          <!-- CTA -->
          <div style="background:linear-gradient(135deg,#d97706,#b45309);border-radius:14px;padding:20px 24px;text-align:center;">
            <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#fef3c7;">Review and approve or reject this student now</p>
            <a href="${safePortalUrl}/super-admin/students" style="display:inline-block;background:#ffffff;color:#b45309;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:800;font-size:14px;">
              Open Student Reviews →
            </a>
          </div>

          <p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#9ca3af;text-align:center;">
            This is an automated alert from the Rank Pulse admin system.<br/>
            Sent to you because you are the designated super admin.
          </p>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: PENDING_STUDENT_ESCALATION_EMAIL,
    subject: emailSubject,
    htmlContent,
    textContent,
    messageType: "pending-review-escalation",
    metadata: { studentName, studentEmail, username, subject },
  });
}

function renderStudentReviewInfoRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:10px 0 10px 0;color:#6b7280;font-size:13px;font-weight:700;vertical-align:top;width:160px;">${escapeHtml(label)}</td>
      <td style="padding:10px 0;color:#111827;font-size:14px;line-height:1.7;">${escapeHtml(value || "Not provided")}</td>
    </tr>
  `.trim();
}

export async function sendNewStudentReviewRequestEmail({
  reviewer,
  studentId,
  cycleAt,
  studentSummary,
  quickActionsEnabled,
}: {
  reviewer: StudentReviewRecipient;
  studentId: number;
  cycleAt: number;
  studentSummary: StudentReviewSummary;
  quickActionsEnabled: boolean;
}) {
  const portalUrl = readPortalUrl();
  const safePortalUrl = escapeHtml(portalUrl);
  const safeReviewerName = escapeHtml(reviewer.reviewerName || "Super Admin");
  const subject = `New student setup submitted: ${studentSummary.studentName}`;
  const approveUrl = buildStudentReviewActionUrl({
    studentId,
    reviewerId: reviewer.reviewerId,
    action: "approve",
    cycleAt,
  });
  const rejectUrl = buildStudentReviewActionUrl({
    studentId,
    reviewerId: reviewer.reviewerId,
    action: "reject",
    cycleAt,
  });

  const textLines = [
    `Hi ${reviewer.reviewerName || "Super Admin"},`,
    "",
    "A new student has completed account setup and is waiting for verification.",
    "",
    `Name: ${studentSummary.studentName}`,
    `Username: ${studentSummary.username}`,
    `Email: ${studentSummary.studentEmail}`,
    `Phone: ${studentSummary.phone}`,
    `Submitted at: ${studentSummary.submittedAtLabel}`,
    `Target exam: ${studentSummary.targetExam}`,
    `Date of birth: ${studentSummary.dateOfBirth}`,
    `WhatsApp: ${studentSummary.whatsappNumber}`,
    `Address: ${studentSummary.addressLine}`,
    `Class level: ${studentSummary.classLevel}`,
    `College: ${studentSummary.institutionName}`,
    `University: ${studentSummary.universityName}`,
    `Target year: ${studentSummary.targetYear}`,
    `Learning mode: ${studentSummary.learningMode}`,
    `Learning provider: ${studentSummary.learningProvider}`,
    `How they heard about Rank Pulse: ${studentSummary.hearAboutUs}`,
    "",
  ];

  if (quickActionsEnabled) {
    textLines.push(`Approve: ${approveUrl}`);
    textLines.push(`Reject with reason: ${rejectUrl}`);
    textLines.push("");
  }

  textLines.push(`Open dashboard: ${portalUrl}/super-admin/students`);

  const detailsTable = [
    renderStudentReviewInfoRow("Student name", studentSummary.studentName),
    renderStudentReviewInfoRow("Username", `@${studentSummary.username}`),
    renderStudentReviewInfoRow("Email", studentSummary.studentEmail),
    renderStudentReviewInfoRow("Phone", studentSummary.phone),
    renderStudentReviewInfoRow("Submitted at", studentSummary.submittedAtLabel),
    renderStudentReviewInfoRow("Target exam", studentSummary.targetExam),
    renderStudentReviewInfoRow("Date of birth", studentSummary.dateOfBirth),
    renderStudentReviewInfoRow("WhatsApp", studentSummary.whatsappNumber),
    renderStudentReviewInfoRow("Address", studentSummary.addressLine),
    renderStudentReviewInfoRow("Class level", studentSummary.classLevel),
    renderStudentReviewInfoRow("College", studentSummary.institutionName),
    renderStudentReviewInfoRow("University", studentSummary.universityName),
    renderStudentReviewInfoRow("Target year", studentSummary.targetYear),
    renderStudentReviewInfoRow("Learning mode", studentSummary.learningMode),
    renderStudentReviewInfoRow("Learning provider", studentSummary.learningProvider),
    renderStudentReviewInfoRow("Discovery source", studentSummary.hearAboutUs),
  ].join("");

  const actionBlock = quickActionsEnabled
    ? `
      <div style="margin-top:24px;display:flex;flex-wrap:wrap;gap:12px;">
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
          Verify Student
        </a>
        <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
          Reject With Reason
        </a>
      </div>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#6b7280;">
        These quick actions stay valid for the current review cycle only. If the student resubmits updated details later, old links stop working automatically.
      </p>
    `.trim()
    : `
      <div style="margin-top:24px;">
        <a href="${safePortalUrl}/super-admin/students" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
          Open Student Reviews
        </a>
      </div>
    `.trim();

  // Profile photos are stored as optimized base64 data URLs. Most email
  // clients strip data: image sources, so send those as an inline CID
  // attachment and keep a normal URL fallback for externally hosted avatars.
  const inlineAvatar = buildInlineStudentAvatar(studentSummary.avatarUrl, studentId);
  const avatarBlock = inlineAvatar.src
    ? `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px 20px;background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;">
        <img
          src="${escapeHtml(inlineAvatar.src)}"
          alt="Profile photo of ${escapeHtml(studentSummary.studentName)}"
          width="72" height="72"
          style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid #f97316;flex-shrink:0;"
        />
        <div>
          <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(studentSummary.studentName)}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">@${escapeHtml(studentSummary.username)} · ${escapeHtml(studentSummary.studentEmail)}</p>
        </div>
      </div>
    `.trim()
    : `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px 20px;background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;">
        <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#f97316,#d97706);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:28px;font-weight:700;color:#ffffff;">
          ${escapeHtml(studentSummary.studentName.charAt(0).toUpperCase())}
        </div>
        <div>
          <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(studentSummary.studentName)}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">@${escapeHtml(studentSummary.username)} · ${escapeHtml(studentSummary.studentEmail)}</p>
        </div>
      </div>
    `.trim();

  const htmlContent = `
    <div style="background:#0f172a;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1f2937;">
      <div style="max-width:680px;margin:0 auto;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1c1917 0%,#7c2d12 60%,#d97706 100%);border-radius:20px 20px 0 0;padding:24px 28px;">
          <div style="display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,0.15);margin-bottom:12px;">
            <div style="width:6px;height:6px;border-radius:50%;background:#fde68a;"></div>
            <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fde68a;">New Student Review</span>
          </div>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.2;color:#ffffff;">Student setup submitted for verification</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;color:rgba(255,255,255,0.75);">
            Hi ${safeReviewerName}, a new student has completed onboarding and is waiting for your review.
          </p>
        </div>

        <!-- Main card -->
        <div style="background:#ffffff;border-radius:0 0 20px 20px;padding:28px;">

          <!-- Student profile -->
          ${avatarBlock}

          <!-- Details table in card -->
          <div style="border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;margin-bottom:24px;">
            <div style="background:#f9fafb;padding:12px 20px;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;">Student Details</p>
            </div>
            <div style="padding:0 20px;">
              <table style="width:100%;border-collapse:collapse;">
                ${detailsTable}
              </table>
            </div>
          </div>

          <!-- Action block -->
          ${actionBlock}

          <p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#9ca3af;text-align:center;">
            This is an automated notification from Rank Pulse.<br/>
            Quick-action links are valid for the current review cycle only.
          </p>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: reviewer.reviewerEmail,
    subject,
    htmlContent,
    textContent: textLines.join("\n"),
    messageType: "student-review-request",
    metadata: {
      studentId,
      reviewerId: reviewer.reviewerId,
      studentEmail: studentSummary.studentEmail,
      targetExam: studentSummary.targetExam,
      quickActionsEnabled,
    },
    attachments: inlineAvatar.attachment ? [inlineAvatar.attachment] : undefined,
  });
}

export function queueStudentApprovedEmail(args: { studentName: string; email: string }) {
  void sendStudentApprovedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email }, "Failed to send student approval email via Brevo");
  });
}

export function queueTeacherWelcomeEmail(args: {
  teacherName: string;
  email: string;
  username: string;
  password: string;
  subject?: string | null;
}) {
  void sendTeacherWelcomeEmail(args).catch((error) => {
    logger.warn({ error, email: args.email }, "Failed to send teacher welcome email");
  });
}

export function queueStudentTestResultEmail(args: StudentTestResultEmailArgs) {
  void sendStudentTestResultEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, testId: args.testId }, "Failed to send student test result email via Brevo");
  });
}

export function queuePasswordChangedEmail(args: {
  accountName: string;
  email: string;
  username: string;
  roleLabel?: string | null;
}) {
  void sendPasswordChangedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, username: args.username }, "Failed to send password changed email via Brevo");
  });
}

export function queueStudentQuestionReportAcknowledgementEmail(args: StudentQuestionReportAcknowledgementEmailArgs) {
  void sendStudentQuestionReportAcknowledgementEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, questionLabel: args.questionLabel }, "Failed to send question report acknowledgement email via Brevo");
  });
}

export function queueTeacherQuestionReportAlertEmail(args: TeacherQuestionReportAlertEmailArgs) {
  void sendTeacherQuestionReportAlertEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, questionLabel: args.questionLabel }, "Failed to send teacher question report alert email via Brevo");
  });
}

export function queueStudentQuestionReportRejectedEmail(args: StudentQuestionReportRejectedEmailArgs) {
  void sendStudentQuestionReportRejectedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, questionLabel: args.questionLabel }, "Failed to send question report rejected email via Brevo");
  });
}

export function queueStudentQuestionUpdatedEmail(args: StudentQuestionUpdatedEmailArgs) {
  void sendStudentQuestionUpdatedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email, questionLabel: args.questionLabel }, "Failed to send question updated email via Brevo");
  });
}

export function queueStudentRejectedEmail(args: { studentName: string; email: string; reason: string }) {
  void sendStudentRejectedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email }, "Failed to send student rejection email via Brevo");
  });
}

export async function sendStudentTestsLockedEmail({
  studentName,
  email,
  cycle,
  unlockAmount,
  supportEmail,
}: {
  studentName: string;
  email: string;
  cycle: number;
  unlockAmount: number | null;
  supportEmail: string;
}) {
  const safeName = escapeHtml(studentName.trim() || "Student");
  const portalUrl = readPortalUrl();
  const safePortalUrl = escapeHtml(portalUrl);
  const safeSupportEmail = escapeHtml(supportEmail);
  const amountLine = unlockAmount != null ? `Complete the one-time payment of ₹${unlockAmount} to regain access.` : "Contact the admin to receive a payment link.";

  const subject = "Your RankPulse test access has been locked";
  const textContent = [
    `Hi ${studentName || "Student"},`,
    "",
    `Your test access on RankPulse has been locked (Cycle #${cycle}).`,
    amountLine,
    "",
    `Support: ${supportEmail}`,
    `Portal: ${portalUrl}`,
    "",
    "Team RankPulse",
  ].join("\n");

  const htmlContent = `
    <div style="background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fca5a5;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#fff1f2 0%,#ffe4e6 100%);border-bottom:1px solid #fca5a5;">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#dc2626;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
            Access Locked
          </div>
          <h1 style="margin:16px 0 8px;font-size:26px;line-height:1.1;color:#111827;">Your test access has been locked</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
            Hi ${safeName}, your RankPulse test access has been locked by the admin (Cycle #${cycle}).
          </p>
        </div>
        <div style="padding:28px;">
          <div style="border:1px solid #fed7aa;border-radius:18px;background:#fffaf0;padding:18px 20px;">
            <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#92400e;">What this means</p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#374151;">
              You will not be able to attempt any tests until your access is unlocked again.
            </p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
              ${escapeHtml(amountLine)}
            </p>
          </div>
          ${unlockAmount != null ? `
          <div style="margin-top:20px;border:1px solid #bbf7d0;border-radius:18px;background:#f0fdf4;padding:18px 20px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#166534;">Unlock Amount</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#111827;">₹${unlockAmount}</p>
            <p style="margin:6px 0 0;font-size:12px;color:#4b5563;">One-time payment — unlocks all tests instantly after verification.</p>
          </div>` : ""}
          <div style="margin-top:24px;text-align:center;">
            <a href="${safePortalUrl}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:14px;font-weight:700;font-size:15px;">
              Go to RankPulse Portal
            </a>
          </div>
          <div style="margin-top:24px;border-top:1px solid #f3f4f6;padding-top:18px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9a6b2c;">Need help?</p>
            <p style="margin:0;font-size:13px;color:#6b7280;">
              Reply to this email or contact us at <a href="mailto:${safeSupportEmail}" style="color:#d97706;text-decoration:none;">${safeSupportEmail}</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  await sendBrevoEmail({
    to: email,
    subject,
    htmlContent,
    textContent,
    messageType: "student-tests-locked",
    metadata: { studentName, cycle },
  });
}

export function queueStudentTestsLockedEmail(args: {
  studentName: string;
  email: string;
  cycle: number;
  unlockAmount: number | null;
  supportEmail: string;
}) {
  void sendStudentTestsLockedEmail(args).catch((error) => {
    logger.warn({ error, email: args.email }, "Failed to send student tests-locked email via Brevo");
  });
}

export function queuePendingStudentReviewEscalationEmail(args: {
  studentName: string;
  studentEmail: string;
  username: string;
  subject: string | null;
  reviewStartedAt: Date | string | null;
}) {
  void sendPendingStudentReviewEscalationEmail(args).catch((error) => {
    logger.warn(
      { error, email: PENDING_STUDENT_ESCALATION_EMAIL, studentEmail: args.studentEmail },
      "Failed to send pending student review escalation email via Brevo",
    );
  });
}

export function queueNewStudentReviewRequestEmails(args: {
  studentId: number;
  cycleAt: number;
  studentSummary: StudentReviewSummary;
  recipients: StudentReviewRecipient[];
  quickActionsEnabled: boolean;
}) {
  for (const reviewer of args.recipients) {
    void sendNewStudentReviewRequestEmail({
      reviewer,
      studentId: args.studentId,
      cycleAt: args.cycleAt,
      studentSummary: args.studentSummary,
      quickActionsEnabled: args.quickActionsEnabled,
    }).catch((error) => {
      logger.warn(
        { error, reviewerEmail: reviewer.reviewerEmail, studentEmail: args.studentSummary.studentEmail },
        "Failed to send new student review request email via Brevo",
      );
    });
  }
}

/* ── Broadcast email (super admin → all students) ──────────────────────── */

export type StudentEmailStats = {
  name: string;
  rank: number | null;
  totalStudents: number;
  totalScore: number;
  testsCompleted: number;
  avgPercentage: number;
  inactiveDays?: number | null;
  /** Tests taken in the last 7 days */
  weeklyTests?: number;
  /** Avg score % in the last 7 days */
  weeklyAvgPct?: number;
};

export function buildPersonalizedBroadcastEmailHtml({
  title,
  message,
  emoji,
  category,
  portalUrl,
  countdownDate,
  countdownLabel,
  stats,
}: {
  title: string;
  message: string;
  emoji: string;
  category: string;
  portalUrl: string;
  countdownDate: string | null;
  countdownLabel: string;
  stats: StudentEmailStats;
}): string {
  const { name, rank, totalStudents, totalScore, testsCompleted, avgPercentage } = stats;
  const safeName      = escapeHtml(name || "Student");
  const safeTitle     = escapeHtml(title.trim());
  const safeCategory  = escapeHtml(category.trim() || "Announcement");
  const safePortalUrl = escapeHtml(portalUrl.trim() || "https://rankpulse.in");
  const safeLabel     = escapeHtml(countdownLabel || "Exam");

  const personalised = message.replace(/\{name\}/gi, name || "Student");
  const pct = Math.round(Math.min(100, Math.max(0, avgPercentage)));
  const barColor = pct >= 75 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
  const rankEmoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank && rank <= 10 ? "🏅" : "📊";

  /* ── Shared helpers ── */
  const msgParas = (color: string) => personalised.trim().split(/\n+/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.8;color:${color};">${escapeHtml(p)}</p>`)
    .join("");

  const sharedFooter = (bg: string) => `
    <div style="background:${bg};padding:28px 24px 24px;text-align:center;border-radius:0 0 24px 24px;border-top:1px solid rgba(255,255,255,.04);">
      <span style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:999px;padding:5px 20px;font-size:12px;font-weight:900;color:#fff;letter-spacing:.1em;">RANK PULSE</span>
      <p style="margin:12px 0 0;font-size:12px;font-weight:600;color:rgba(255,255,255,.4);">India's smartest exam prep platform</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;"><tr>
        <td style="text-align:center;">
          <a href="${safePortalUrl}/student/tests" style="display:inline-block;margin:0 8px;font-size:11px;font-weight:700;color:rgba(255,255,255,.3);text-decoration:none;">📝 Tests</a>
          <a href="${safePortalUrl}/student/dashboard" style="display:inline-block;margin:0 8px;font-size:11px;font-weight:700;color:rgba(255,255,255,.3);text-decoration:none;">📊 Dashboard</a>
          <a href="${safePortalUrl}/student/question-bank" style="display:inline-block;margin:0 8px;font-size:11px;font-weight:700;color:rgba(255,255,255,.3);text-decoration:none;">📚 Questions</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:10px;color:rgba(255,255,255,.18);">You're receiving this as an active Rank Pulse student. &nbsp;·&nbsp; <a href="${safePortalUrl}" style="color:rgba(255,255,255,.25);text-decoration:none;">Manage Notifications</a></p>
    </div>`;

  const statCell = (icon: string, val: string, lbl: string, color: string, bg: string) =>
    `<td style="text-align:center;padding:0 4px;">
      <div style="background:${bg};border-radius:14px;padding:16px 8px;">
        <div style="font-size:20px;margin-bottom:6px;">${icon}</div>
        <div style="font-size:19px;font-weight:900;color:${color};line-height:1;">${val}</div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.35);margin-top:5px;">${lbl}</div>
      </div>
    </td>`;

  const cat = (category || "").toLowerCase();

  /* ══════════════════════════════════════════════════════
     1. ENGAGEMENT — 🎯 Test Motivation
        Theme: Black + Red bullseye, laser-focused
  ══════════════════════════════════════════════════════ */
  if (cat === "engagement") {
    const rankGrad = rank && rank <= 3 ? "linear-gradient(135deg,#7f1d1d,#dc2626,#f87171)" : rank && rank <= 10 ? "linear-gradient(135deg,#451a03,#b45309,#fbbf24)" : "linear-gradient(135deg,#1c1917,#44403c,#78716c)";
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0c0a09;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🎯 ${safeName} — your target is waiting. Open now!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Red concentric rings -->
  <div style="background:linear-gradient(160deg,#1a0000 0%,#450a0a 40%,#7f1d1d 100%);border-radius:24px 24px 0 0;padding:48px 32px 40px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;height:400px;border-radius:50%;border:1px solid rgba(239,68,68,.08);"></div>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:280px;height:280px;border-radius:50%;border:1px solid rgba(239,68,68,.13);"></div>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:160px;height:160px;border-radius:50%;border:1px solid rgba(239,68,68,.2);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fca5a5;margin-bottom:20px;">🎯 Engagement</div>
      <div style="font-size:52px;margin-bottom:12px;">🎯</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">Hi ${safeName}!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.65);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#111111;border-left:1px solid rgba(239,68,68,.12);border-right:1px solid rgba(239,68,68,.12);">

    <!-- RANK bullseye card -->
    <div style="padding:32px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:${rankGrad};border-radius:20px;padding:24px 48px;box-shadow:0 12px 40px rgba(239,68,68,.3);">
        <div style="font-size:40px;margin-bottom:4px;">${rankEmoji}</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:rgba(255,255,255,.6);">YOUR RANK</div>
        ${rank != null ? `<div style="font-size:52px;font-weight:900;color:#fff;line-height:1;">#${rank}</div><div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:6px;">out of ${totalStudents} students</div>` : `<div style="font-size:22px;font-weight:800;color:rgba(255,255,255,.6);margin-top:8px;">Take a test to rank!</div>`}
      </div>
    </div>

    <!-- Stats -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#f87171", "rgba(239,68,68,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#4ade80", "rgba(34,197,94,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🎯", rank != null ? `#${rank}` : "—", "Rank", "#f87171", "rgba(239,68,68,.08)")}
        </tr>
      </table>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-left:4px solid #dc2626;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#f87171;margin-bottom:12px;">💬 Message for You</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 24px rgba(220,38,38,.4);">🎯 Take a Test Now →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.25);">Hit your target today — every test counts</p>
    </div>
  </div>
  ${sharedFooter("#0a0808")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     2. ANNOUNCEMENT — 🚀 New Feature Launch
        Theme: Deep purple / space / product reveal
  ══════════════════════════════════════════════════════ */
  if (cat === "announcement") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#07040f;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🚀 ${safeName} — something new just launched on Rank Pulse!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Space / purple -->
  <div style="background:linear-gradient(160deg,#0d0521 0%,#2e1065 50%,#4c1d95 80%,#7c3aed 100%);border-radius:24px 24px 0 0;padding:52px 32px 44px;text-align:center;position:relative;overflow:hidden;">
    <!-- stars -->
    <div style="position:absolute;top:12px;left:18px;width:3px;height:3px;background:#fff;border-radius:50%;opacity:.6;"></div>
    <div style="position:absolute;top:28px;left:80px;width:2px;height:2px;background:#c4b5fd;border-radius:50%;opacity:.8;"></div>
    <div style="position:absolute;top:18px;right:40px;width:3px;height:3px;background:#fff;border-radius:50%;opacity:.5;"></div>
    <div style="position:absolute;top:50px;right:90px;width:2px;height:2px;background:#ddd6fe;border-radius:50%;opacity:.7;"></div>
    <div style="position:absolute;bottom:30px;left:30px;width:2px;height:2px;background:#c4b5fd;border-radius:50%;opacity:.6;"></div>
    <div style="position:absolute;top:40px;left:50%;width:200px;height:200px;background:rgba(124,58,237,.15);border-radius:50%;transform:translateX(-50%);filter:blur(40px);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.35);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#c4b5fd;margin-bottom:20px;">🚀 New Launch</div>
      <div style="font-size:56px;margin-bottom:14px;">🚀</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">Hey ${safeName}!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.65);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#0f0a1e;border-left:1px solid rgba(124,58,237,.15);border-right:1px solid rgba(124,58,237,.15);">

    <!-- Feature spotlight -->
    <div style="padding:32px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:linear-gradient(135deg,#2e1065,#4c1d95,#7c3aed);border-radius:20px;padding:28px 44px;box-shadow:0 12px 40px rgba(124,58,237,.35);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:rgba(196,181,253,.7);margin-bottom:8px;">Just Launched ✨</div>
        <div style="font-size:42px;font-weight:900;color:#fff;line-height:1;">NEW</div>
        <div style="font-size:14px;color:rgba(196,181,253,.8);margin-top:8px;font-weight:600;">Feature on Rank Pulse</div>
      </div>
    </div>

    <!-- Stats (feature context) -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#a78bfa", "rgba(124,58,237,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#6ee7b7", "rgba(52,211,153,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🏅", rank != null ? `#${rank}` : "—", "Rank", "#c4b5fd", "rgba(167,139,250,.08)")}
        </tr>
      </table>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.25);border-left:4px solid #7c3aed;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a78bfa;margin-bottom:12px;">💬 From the RankPulse Team</div>
        ${msgParas("rgba(255,255,255,.75)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(124,58,237,.45);">🚀 Explore the New Feature →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">Be among the first to try it</p>
    </div>
  </div>
  ${sharedFooter("#07040f")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     3. REMINDER — 📊 Weekly Progress Push
        Theme: Dark navy / data-driven / charts & bars
  ══════════════════════════════════════════════════════ */
  if (cat === "reminder") {
    const wTests   = stats.weeklyTests  ?? 0;
    const wAvg     = stats.weeklyAvgPct ?? 0;
    const wVsAll   = pct > 0 ? wAvg - pct : 0;               // +ve = improving this week
    const trendUp  = wTests > 0 && wVsAll >= 0;
    const trendClr = trendUp ? "#34d399" : "#f87171";
    const trendTxt = wTests === 0
      ? "😴 No tests this week"
      : wVsAll > 0
        ? `📈 +${wVsAll}% vs your average`
        : wVsAll === 0
          ? "➡️ Matching your average"
          : `📉 ${wVsAll}% vs your average`;
    const barGlow = pct >= 75 ? "#6ee7b7" : pct >= 50 ? "#fde68a" : "#fca5a5";
    const topPct = (rank && totalStudents > 0)
      ? Math.ceil((rank / totalStudents) * 100) : null;
    const rankLine = rank != null
      ? `#${rank} of ${totalStudents} students${topPct !== null ? ` · Top ${topPct}%` : ""}`
      : "Not yet ranked";

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#030712;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">📊 ${safeName} — ${wTests > 0 ? `This week: ${wTests} test${wTests > 1 ? "s" : ""}, ${wAvg}% avg. Your overall rank: ${rank != null ? "#" + rank : "unranked"}.` : "Your weekly progress report is ready."}</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO -->
  <div style="background:linear-gradient(160deg,#0c1445 0%,#1e3a8a 55%,#1d4ed8 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;bottom:0;left:0;right:0;height:50px;background:repeating-linear-gradient(90deg,rgba(59,130,246,.08) 0,rgba(59,130,246,.08) 1px,transparent 1px,transparent 40px);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(59,130,246,.2);border:1px solid rgba(96,165,250,.35);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#93c5fd;margin-bottom:20px;">📊 Weekly Recap</div>
      <div style="font-size:52px;margin-bottom:12px;">📊</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}'s Weekly Report</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.65);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <div style="background:#0d1117;border-left:1px solid rgba(59,130,246,.12);border-right:1px solid rgba(59,130,246,.12);">

    <!-- ── THIS WEEK card (most important, goes first) ── -->
    <div style="padding:28px 24px 20px;">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px;">📅 THIS WEEK (LAST 7 DAYS)</div>
      ${wTests === 0
        ? `<div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:18px;padding:20px 24px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">😴</div>
            <div style="font-size:17px;font-weight:800;color:#f87171;">No tests taken this week</div>
            <div style="font-size:13px;color:rgba(255,255,255,.4);margin-top:4px;">Your peers are practising — don't fall behind</div>
          </div>`
        : `<div style="background:linear-gradient(135deg,rgba(30,58,138,.5),rgba(17,24,39,.8));border:1px solid rgba(59,130,246,.2);border-radius:20px;padding:22px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:13px;color:rgba(255,255,255,.5);">Tests taken</div>
                  <div style="font-size:34px;font-weight:900;color:#fff;line-height:1;">${wTests}</div>
                </td>
                <td style="text-align:center;padding:0 12px;vertical-align:middle;">
                  <div style="width:1px;height:50px;background:rgba(255,255,255,.08);margin:0 auto;"></div>
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-size:13px;color:rgba(255,255,255,.5);">Avg this week</div>
                  <div style="font-size:34px;font-weight:900;color:${wAvg >= 75 ? "#34d399" : wAvg >= 50 ? "#fbbf24" : "#f87171"};line-height:1;">${wAvg}%</div>
                </td>
                <td style="text-align:right;vertical-align:middle;">
                  <div style="display:inline-block;background:rgba(${trendUp ? "52,211,153" : "248,113,113"},.12);border:1px solid rgba(${trendUp ? "52,211,153" : "248,113,113"},.25);border-radius:999px;padding:6px 14px;font-size:12px;font-weight:800;color:${trendClr};">${trendTxt}</div>
                </td>
              </tr>
            </table>
            <div style="margin-top:16px;background:rgba(255,255,255,.06);border-radius:999px;height:10px;overflow:hidden;">
              <div style="height:10px;border-radius:999px;background:linear-gradient(90deg,${wAvg >= 75 ? "#059669,#34d399" : wAvg >= 50 ? "#d97706,#fbbf24" : "#dc2626,#f87171"});width:${wAvg}%;"></div>
            </div>
          </div>`
      }
    </div>

    <!-- ── ALL-TIME stats ── -->
    <div style="padding:0 24px 20px;">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px;">📈 ALL-TIME PERFORMANCE</div>
      <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="text-align:center;padding:0 4px;">
            <div style="font-size:24px;font-weight:900;color:#60a5fa;">${testsCompleted}</div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:3px;">Tests Done</div>
          </td>
          <td style="text-align:center;padding:0 4px;border-left:1px solid rgba(255,255,255,.06);">
            <div style="font-size:24px;font-weight:900;color:${barColor};">${pct}%</div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:3px;">Avg Score</div>
          </td>
          <td style="text-align:center;padding:0 4px;border-left:1px solid rgba(255,255,255,.06);">
            <div style="font-size:24px;font-weight:900;color:#a78bfa;">${rank != null ? "#" + rank : "—"}</div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:3px;">Your Rank</div>
          </td>
          <td style="text-align:center;padding:0 4px;border-left:1px solid rgba(255,255,255,.06);">
            <div style="font-size:24px;font-weight:900;color:#fbbf24;">${Math.round(totalScore)}</div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:3px;">Total Pts</div>
          </td>
        </tr></table>
        ${rank != null ? `<div style="margin-top:14px;text-align:center;"><span style="display:inline-block;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);border-radius:999px;padding:4px 14px;font-size:11px;font-weight:700;color:#c4b5fd;">${rankLine}</span></div>` : ""}
      </div>
    </div>

    <!-- Admin message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.2);border-left:4px solid #3b82f6;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa;margin-bottom:12px;">💬 Message from Admin</div>
        ${msgParas("rgba(255,255,255,.75)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/dashboard" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(37,99,235,.4);">📊 View My Full Dashboard →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">New week — new targets to hit</p>
    </div>
  </div>
  ${sharedFooter("#030712")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     4. RECOGNITION — 🏆 Leaderboard Shoutout
        Theme: Gold / trophy / championship podium
  ══════════════════════════════════════════════════════ */
  if (cat === "recognition") {
    const rankGold = rank === 1 ? "linear-gradient(135deg,#713f12,#d97706,#fde68a,#d97706)" : rank === 2 ? "linear-gradient(135deg,#374151,#6b7280,#d1d5db,#9ca3af)" : rank === 3 ? "linear-gradient(135deg,#431407,#c2410c,#fb923c)" : "linear-gradient(135deg,#1c1917,#44403c,#a8a29e)";
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0a0800;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🏆 ${safeName} — leaderboard results are in! Check your rank!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Gold championship -->
  <div style="background:linear-gradient(160deg,#1a1000 0%,#451a03 40%,#92400e 80%,#b45309 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 0%,rgba(253,230,138,.08) 0%,transparent 70%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(253,230,138,.12);border:1px solid rgba(253,230,138,.3);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fde68a;margin-bottom:20px;">🏆 Recognition</div>
      <div style="font-size:60px;margin-bottom:10px;">🏆</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}, You Made It!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.65);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#120e02;border-left:1px solid rgba(253,230,138,.08);border-right:1px solid rgba(253,230,138,.08);">

    <!-- Trophy / rank card -->
    <div style="padding:32px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:${rankGold};border-radius:20px;padding:26px 52px;box-shadow:0 12px 40px rgba(180,83,9,.4);">
        <div style="font-size:48px;margin-bottom:6px;">${rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏅"}</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.65);margin-bottom:4px;">LEADERBOARD RANK</div>
        ${rank != null ? `<div style="font-size:52px;font-weight:900;color:#fff;line-height:1;">#${rank}</div><div style="font-size:12px;color:rgba(255,255,255,.55);margin-top:6px;">out of ${totalStudents} students</div>` : `<div style="font-size:20px;font-weight:800;color:rgba(255,255,255,.6);margin-top:8px;">You're on the board!</div>`}
      </div>
    </div>

    <!-- Stats -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("🌟", String(Math.round(totalScore)), "Total Pts", "#fbbf24", "rgba(251,191,36,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#34d399", "rgba(52,211,153,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🏆", rank != null ? `#${rank}` : "—", "Rank", "#fde68a", "rgba(253,230,138,.08)")}
        </tr>
      </table>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(180,83,9,.08);border:1px solid rgba(253,230,138,.15);border-left:4px solid #d97706;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fbbf24;margin-bottom:12px;">💬 Shoutout from Admin</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}" style="display:inline-block;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(180,83,9,.45);">🏆 View Leaderboard →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">Stay at the top — keep competing</p>
    </div>
  </div>
  ${sharedFooter("#0a0800")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     5. RE-ENGAGEMENT — 😴 Inactivity Nudge
        Theme: Cold grey → warm comeback gradient
  ══════════════════════════════════════════════════════ */
  if (cat === "re-engagement") {
    const missingDays  = stats.inactiveDays ?? 0;
    const urgencyColor = missingDays >= 30 ? "#ef4444" : missingDays >= 14 ? "#f97316" : "#f59e0b";
    const urgencyBadge = missingDays >= 30
      ? "🔴 Critical — a full month gone!"
      : missingDays >= 14
        ? "🟠 2+ weeks away from practice"
        : missingDays >= 7
          ? "🟡 A week without tests"
          : "⚠️ Time to get back on track";
    // Build a "what's at stake" message based on rank
    const rankAtStake = rank != null
      ? `You were ranked <strong style="color:#fbbf24;">#${rank} out of ${totalStudents} students</strong>. While you've been away, students ranked below you have been practising every day.`
      : `You've completed <strong style="color:#fbbf24;">${testsCompleted} test${testsCompleted !== 1 ? "s" : ""}</strong> with a ${pct}% average — don't let that go to waste.`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">😴 ${safeName} — ${missingDays > 0 ? `${missingDays} days without practice. Your rank is at risk.` : "Come back today!"} ${rank != null ? `Last rank: #${rank}` : ""}</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO -->
  <div style="background:linear-gradient(160deg,#111111 0%,#1c1c1c 50%,#2d1a00 80%,#451a03 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 80% 50%,rgba(249,115,22,.06) 0%,transparent 60%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.3);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fdba74;margin-bottom:20px;">😴 We Miss You</div>
      <div style="font-size:56px;margin-bottom:10px;">😴</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}, Come Back!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.6);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <div style="background:#111111;border-left:1px solid rgba(249,115,22,.1);border-right:1px solid rgba(249,115,22,.1);">

    <!-- ── Inactivity timer (big, personalised) ── -->
    <div style="padding:28px 24px 20px;text-align:center;">
      ${missingDays > 0
        ? `<div style="display:inline-block;background:linear-gradient(135deg,rgba(239,68,68,.12),rgba(220,38,38,.06));border:2px solid rgba(${missingDays >= 30 ? "239,68,68" : missingDays >= 14 ? "249,115,22" : "245,158,11"},.35);border-radius:22px;padding:28px 56px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(252,165,165,.65);margin-bottom:8px;">DAYS WITHOUT PRACTICE</div>
            <div style="font-size:72px;font-weight:900;color:${urgencyColor};line-height:1;">${missingDays}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.4);margin-top:6px;">day${missingDays === 1 ? "" : "s"} since ${safeName}'s last session</div>
            <div style="margin-top:14px;display:inline-block;background:rgba(${missingDays >= 14 ? "239,68,68" : "245,158,11"},.12);border:1px solid rgba(${missingDays >= 14 ? "239,68,68" : "245,158,11"},.3);border-radius:999px;padding:5px 14px;font-size:11px;font-weight:800;color:${urgencyColor};">${urgencyBadge}</div>
          </div>`
        : `<div style="font-size:48px;margin-bottom:8px;">👋</div><div style="font-size:16px;font-weight:700;color:rgba(255,255,255,.6);">Good to see you — let's get back to it!</div>`
      }
    </div>

    <!-- ── What's at stake — rank context ── -->
    <div style="padding:0 24px 20px;">
      <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.18);border-radius:18px;padding:18px 22px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(252,165,165,.5);margin-bottom:10px;">⚠️ WHAT'S AT STAKE</div>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:rgba(255,255,255,.7);">${rankAtStake}</p>
        ${testsCompleted > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>
          <td style="text-align:center;padding:0 4px;">
            <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:12px 8px;">
              <div style="font-size:22px;font-weight:900;color:#fbbf24;">${rank != null ? "#" + rank : "—"}</div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:2px;">Rank</div>
            </div>
          </td>
          <td style="text-align:center;padding:0 4px;">
            <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:12px;padding:12px 8px;">
              <div style="font-size:22px;font-weight:900;color:#34d399;">${testsCompleted}</div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:2px;">Tests Done</div>
            </div>
          </td>
          <td style="text-align:center;padding:0 4px;">
            <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.18);border-radius:12px;padding:12px 8px;">
              <div style="font-size:22px;font-weight:900;color:#60a5fa;">${pct}%</div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:2px;">Avg Score</div>
            </div>
          </td>
          <td style="text-align:center;padding:0 4px;">
            <div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.18);border-radius:12px;padding:12px 8px;">
              <div style="font-size:22px;font-weight:900;color:#a78bfa;">${totalStudents}</div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.3);margin-top:2px;">Students</div>
            </div>
          </td>
        </tr></table>` : ""}
      </div>
    </div>

    <!-- ── 3 comeback steps ── -->
    <div style="padding:0 24px 24px;">
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.25);margin-bottom:12px;text-align:center;">🚀 3 STEPS TO COME BACK STRONGER</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding:0 5px 0 0;width:33.33%;vertical-align:top;">
          <div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.15);border-radius:14px;padding:16px 10px;text-align:center;">
            <div style="font-size:26px;margin-bottom:6px;">📝</div>
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.75);">Take 1 Test</div>
            <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:3px;">Just 15 mins</div>
          </div>
        </td>
        <td style="padding:0 2.5px;width:33.33%;vertical-align:top;">
          <div style="background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.15);border-radius:14px;padding:16px 10px;text-align:center;">
            <div style="font-size:26px;margin-bottom:6px;">📊</div>
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.75);">Check Your Rank</div>
            <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:3px;">See where you stand</div>
          </div>
        </td>
        <td style="padding:0 0 0 5px;width:33.33%;vertical-align:top;">
          <div style="background:rgba(96,165,250,.07);border:1px solid rgba(96,165,250,.15);border-radius:14px;padding:16px 10px;text-align:center;">
            <div style="font-size:26px;margin-bottom:6px;">🎯</div>
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.75);">Revise Weak Topics</div>
            <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:3px;">Target gaps today</div>
          </div>
        </td>
      </tr></table>
    </div>

    <!-- Admin message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(249,115,22,.07);border:1px solid rgba(249,115,22,.2);border-left:4px solid #f97316;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fdba74;margin-bottom:12px;">💬 From Your Admin</div>
        ${msgParas("rgba(255,255,255,.75)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(249,115,22,.4);">🔥 Come Back &amp; Practice →</a>
      <p style="margin:12px 0 0;font-size:12px;color:rgba(255,255,255,.3);">Your rank of ${rank != null ? "#" + rank : "—"} is waiting — don't let it slip further</p>
    </div>
  </div>
  ${sharedFooter("#0a0a0a")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     6. URGENT — 📅 Exam Countdown
        Theme: Deep red alarm / emergency / deadline
  ══════════════════════════════════════════════════════ */
  if (cat === "urgent") {
    let cdHtml = "";
    if (countdownDate) {
      const ms = new Date(countdownDate).getTime() - Date.now();
      const days = Math.max(0, Math.floor(ms / 86_400_000));
      const hours = Math.max(0, Math.floor((ms % 86_400_000) / 3_600_000));
      const mins = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
      cdHtml = `
      <div style="padding:0 24px 24px;">
        <div style="background:linear-gradient(135deg,rgba(127,29,29,.6),rgba(69,10,10,.8));border:1px solid rgba(239,68,68,.3);border-radius:20px;padding:26px 20px;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(252,165,165,.65);margin-bottom:16px;">⏰ ${escapeHtml(safeLabel)} Countdown</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:300px;margin:0 auto;">
            <tr>
              <td style="text-align:center;padding:0 5px;"><div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:14px;padding:16px 8px;"><div style="font-size:38px;font-weight:900;color:#f87171;line-height:1;">${days}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);margin-top:4px;">Days</div></div></td>
              <td style="text-align:center;font-size:24px;color:rgba(239,68,68,.4);font-weight:900;vertical-align:middle;padding-bottom:18px;">:</td>
              <td style="text-align:center;padding:0 5px;"><div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:14px;padding:16px 8px;"><div style="font-size:38px;font-weight:900;color:#f87171;line-height:1;">${String(hours).padStart(2,"0")}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);margin-top:4px;">Hrs</div></div></td>
              <td style="text-align:center;font-size:24px;color:rgba(239,68,68,.4);font-weight:900;vertical-align:middle;padding-bottom:18px;">:</td>
              <td style="text-align:center;padding:0 5px;"><div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:14px;padding:16px 8px;"><div style="font-size:38px;font-weight:900;color:#f87171;line-height:1;">${String(mins).padStart(2,"0")}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.35);margin-top:4px;">Mins</div></div></td>
            </tr>
          </table>
          <div style="margin-top:16px;display:inline-block;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:999px;padding:6px 18px;font-size:12px;font-weight:700;color:#fca5a5;">${days <= 7 ? "🔥 Final stretch — all or nothing!" : `${days} days — use every single one`}</div>
        </div>
      </div>`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0a0000;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">📅 URGENT: ${safeName} — Exam is near! Time is running out!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Red alarm -->
  <div style="background:linear-gradient(160deg,#1a0000 0%,#7f1d1d 50%,#dc2626 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,.01) 10px,rgba(255,255,255,.01) 20px);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.5);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fca5a5;margin-bottom:20px;">🚨 Urgent</div>
      <div style="font-size:56px;margin-bottom:10px;">📅</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}!</h1>
      <p style="margin:0 auto;font-size:16px;color:rgba(255,255,255,.75);line-height:1.5;max-width:420px;font-weight:600;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#110000;border-left:1px solid rgba(239,68,68,.15);border-right:1px solid rgba(239,68,68,.15);">

    ${cdHtml || `<div style="padding:28px 24px 20px;text-align:center;"><div style="display:inline-block;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);border-radius:20px;padding:22px 44px;"><div style="font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:rgba(252,165,165,.6);">Exam is Near</div><div style="font-size:48px;margin:8px 0;">⏳</div><div style="font-size:15px;font-weight:700;color:#fca5a5;">Every Day Counts</div></div></div>`}

    <!-- Stats -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#f87171", "rgba(239,68,68,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#4ade80", "rgba(34,197,94,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🎯", rank != null ? `#${rank}` : "—", "Rank", "#f87171", "rgba(239,68,68,.08)")}
        </tr>
      </table>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-left:4px solid #dc2626;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#f87171;margin-bottom:12px;">💬 Urgent Message</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(220,38,38,.45);">📅 Start Practicing Now →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">No shortcuts — only preparation wins</p>
    </div>
  </div>
  ${sharedFooter("#0a0000")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     7. MOTIVATION — 🔥 Streak & Consistency
        Theme: Fire orange / molten / streak counter
  ══════════════════════════════════════════════════════ */
  if (cat === "motivation") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0a0500;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🔥 ${safeName} — you're on fire! Keep the streak going!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Fire gradient -->
  <div style="background:linear-gradient(160deg,#1a0500 0%,#7c2d12 40%,#ea580c 80%,#f97316 100%);border-radius:24px 24px 0 0;padding:44px 32px 40px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 100%,rgba(251,146,60,.12) 0%,transparent 70%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(251,146,60,.18);border:1px solid rgba(251,146,60,.4);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fed7aa;margin-bottom:20px;">🔥 Motivation</div>
      <div style="font-size:60px;margin-bottom:10px;">🔥</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}, Keep Burning!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.68);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#110800;border-left:1px solid rgba(249,115,22,.12);border-right:1px solid rgba(249,115,22,.12);">

    <!-- Streak fire card -->
    <div style="padding:28px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:linear-gradient(135deg,#431407,#9a3412,#ea580c);border-radius:20px;padding:26px 52px;box-shadow:0 12px 40px rgba(234,88,12,.35);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(253,186,116,.7);">CONSISTENCY</div>
        <div style="font-size:60px;margin:8px 0;">🔥</div>
        <div style="font-size:15px;font-weight:700;color:#fed7aa;">${testsCompleted} Tests Completed</div>
        <div style="font-size:12px;color:rgba(253,186,116,.6);margin-top:4px;">You're building real momentum</div>
      </div>
    </div>

    <!-- Stats -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#fb923c", "rgba(249,115,22,.1)")}
          ${statCell("🔥", String(testsCompleted), "Tests Done", "#fbbf24", "rgba(251,191,36,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🏅", rank != null ? `#${rank}` : "—", "Rank", "#fb923c", "rgba(249,115,22,.08)")}
        </tr>
      </table>
    </div>

    <!-- Progress bar (fire themed) -->
    <div style="padding:0 24px 24px;">
      <div style="background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.15);border-radius:16px;padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
          <tr>
            <td style="font-size:13px;font-weight:700;color:rgba(255,255,255,.8);">🔥 Performance Heat</td>
            <td style="text-align:right;font-size:22px;font-weight:900;color:#fb923c;">${pct}%</td>
          </tr>
        </table>
        <div style="background:rgba(255,255,255,.06);border-radius:999px;height:12px;overflow:hidden;">
          <div style="height:12px;border-radius:999px;background:linear-gradient(90deg,#dc2626,#f97316,#fbbf24);width:${pct}%;"></div>
        </div>
        <div style="margin-top:12px;text-align:center;"><span style="display:inline-block;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.25);border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;color:#fdba74;">${pct >= 75 ? "🔥 On Fire!" : pct >= 50 ? "💪 Heating Up!" : "⚡ Ignite Now!"}</span></div>
      </div>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(234,88,12,.07);border:1px solid rgba(249,115,22,.2);border-left:4px solid #f97316;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fb923c;margin-bottom:12px;">💬 Admin Message</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(249,115,22,.45);">🔥 Keep the Streak Going →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">Consistency is the only strategy that wins</p>
    </div>
  </div>
  ${sharedFooter("#0a0500")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     8. TIPS — 💡 Study Tip / Strategy
        Theme: Dark teal / emerald / wisdom / clean
  ══════════════════════════════════════════════════════ */
  if (cat === "tips") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#021a14;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">💡 ${safeName} — a pro tip just for you from RankPulse!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Teal/emerald wisdom -->
  <div style="background:linear-gradient(160deg,#022c22 0%,#064e3b 50%,#047857 80%,#059669 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle at 30% 50%,rgba(16,185,129,.08) 0%,transparent 60%);"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(16,185,129,.15);border:1px solid rgba(52,211,153,.35);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#6ee7b7;margin-bottom:20px;">💡 Pro Tip</div>
      <div style="font-size:56px;margin-bottom:12px;">💡</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">Hey ${safeName}!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.68);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#031a12;border-left:1px solid rgba(16,185,129,.1);border-right:1px solid rgba(16,185,129,.1);">

    <!-- Tip highlight card -->
    <div style="padding:28px 24px 20px;">
      <div style="background:linear-gradient(135deg,rgba(5,150,105,.15),rgba(4,120,87,.08));border:1px solid rgba(52,211,153,.2);border-radius:20px;padding:24px;text-align:center;">
        <div style="font-size:42px;margin-bottom:10px;">💡</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:rgba(110,231,183,.6);margin-bottom:6px;">STRATEGY OF THE DAY</div>
        <p style="margin:0;font-size:16px;font-weight:700;color:#fff;line-height:1.6;font-style:italic;">"${escapeHtml(safeTitle)}"</p>
        <div style="margin-top:14px;display:inline-block;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.25);border-radius:999px;padding:4px 14px;font-size:11px;font-weight:700;color:#6ee7b7;">⚡ ${pct >= 75 ? "You're already applying this!" : pct >= 50 ? "This could push you to 75%+" : "This tip can change your scores"}</div>
      </div>
    </div>

    <!-- Stats -->
    <div style="padding:8px 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#34d399", "rgba(52,211,153,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#6ee7b7", "rgba(110,231,183,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(16,185,129,.08)")}
          ${statCell("🏅", rank != null ? `#${rank}` : "—", "Rank", "#34d399", "rgba(52,211,153,.08)")}
        </tr>
      </table>
    </div>

    <!-- Tip message — styled as insight box -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(5,150,105,.07);border:1px solid rgba(52,211,153,.15);border-left:4px solid #10b981;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#34d399;margin-bottom:12px;">💡 Full Strategy</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(5,150,105,.4);">💡 Apply This in My Next Test →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">Small strategies, big rank jumps</p>
    </div>
  </div>
  ${sharedFooter("#021a14")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     9. EVENT — 🏅 Contest / Challenge
        Theme: Neon pink/purple / spotlight / festival
  ══════════════════════════════════════════════════════ */
  if (cat === "event") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0f0018;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">🏅 ${safeName} — a special contest just launched! Compete and win!</div>
<div style="max-width:600px;margin:0 auto;padding:16px 12px 24px;">

  <!-- HERO: Neon pink event poster -->
  <div style="background:linear-gradient(160deg,#1a0030 0%,#4a044e 40%,#86198f 75%,#c026d3 100%);border-radius:24px 24px 0 0;padding:44px 32px 40px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 50% 0%,rgba(217,70,239,.12) 0%,transparent 60%);"></div>
    <div style="position:absolute;top:20px;left:20px;width:4px;height:4px;background:#f0abfc;border-radius:50%;opacity:.8;"></div>
    <div style="position:absolute;top:35px;right:35px;width:3px;height:3px;background:#f0abfc;border-radius:50%;opacity:.6;"></div>
    <div style="position:absolute;bottom:25px;left:50px;width:3px;height:3px;background:#e879f9;border-radius:50%;opacity:.7;"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(217,70,239,.18);border:1px solid rgba(240,171,252,.35);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#f0abfc;margin-bottom:20px;">🏅 Live Event</div>
      <div style="font-size:56px;margin-bottom:12px;">🏅</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:900;color:#fff;line-height:1.1;">${safeName}, Compete Now!</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.68);line-height:1.55;max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>

  <!-- BODY -->
  <div style="background:#100020;border-left:1px solid rgba(192,38,211,.15);border-right:1px solid rgba(192,38,211,.15);">

    <!-- Prize / contest card -->
    <div style="padding:28px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:linear-gradient(135deg,#4a044e,#86198f,#c026d3);border-radius:20px;padding:26px 52px;box-shadow:0 12px 40px rgba(192,38,211,.35);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(240,171,252,.65);">CONTEST LIVE NOW</div>
        <div style="font-size:48px;margin:8px 0;">🏅</div>
        <div style="font-size:15px;font-weight:700;color:#f0abfc;">Special Leaderboard</div>
        <div style="font-size:12px;color:rgba(240,171,252,.55);margin-top:4px;">Compete with all students</div>
      </div>
    </div>

    <!-- Stats -->
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#e879f9", "rgba(217,70,239,.1)")}
          ${statCell("✅", String(testsCompleted), "Tests Done", "#c084fc", "rgba(192,132,252,.08)")}
          ${statCell("📈", `${pct}%`, "Avg Score", barColor, "rgba(245,158,11,.08)")}
          ${statCell("🏅", rank != null ? `#${rank}` : "—", "Rank", "#e879f9", "rgba(232,121,249,.08)")}
        </tr>
      </table>
    </div>

    <!-- Message -->
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(192,38,211,.07);border:1px solid rgba(217,70,239,.2);border-left:4px solid #c026d3;border-radius:0 14px 14px 0;padding:20px 22px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#e879f9;margin-bottom:12px;">💬 Event Details</div>
        ${msgParas("rgba(255,255,255,.78)")}
      </div>
    </div>

    <!-- CTA -->
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}/student/tests" style="display:inline-block;background:linear-gradient(135deg,#c026d3,#9333ea);color:#fff;text-decoration:none;padding:17px 46px;border-radius:16px;font-size:16px;font-weight:800;box-shadow:0 8px 28px rgba(192,38,211,.45);">🏅 Join the Contest →</a>
      <p style="margin:12px 0 0;font-size:11px;color:rgba(255,255,255,.22);">Limited time — don't miss your chance</p>
    </div>
  </div>
  ${sharedFooter("#0f0018")}
</div></body></html>`.trim();
  }

  /* ══════════════════════════════════════════════════════
     DEFAULT — original dark amber design (fallback)
  ══════════════════════════════════════════════════════ */
  const rankGrad = rank === 1 ? "linear-gradient(135deg,#92400E,#D97706,#FDE68A)" : rank && rank <= 3 ? "linear-gradient(135deg,#374151,#6B7280,#D1D5DB)" : rank && rank <= 10 ? "linear-gradient(135deg,#78350F,#B45309)" : "linear-gradient(135deg,#1F2937,#374151)";
  const barGlow2 = pct >= 75 ? "#6EE7B7" : pct >= 50 ? "#FDE68A" : "#FCA5A5";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)}</title></head>
<body style="margin:0;padding:0;background:#0F172A;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Hi ${safeName}! 🔥 Open to see your Rank Pulse update</div>
<div style="max-width:600px;margin:0 auto;padding:20px 12px 32px;">
  <div style="background:linear-gradient(135deg,#1C1917 0%,#7C2D12 48%,#D97706 100%);border-radius:24px 24px 0 0;padding:44px 32px 38px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:-50px;right:-40px;width:160px;height:160px;background:rgba(255,255,255,.06);border-radius:50%;"></div>
    <div style="position:relative;z-index:1;">
      <div style="display:inline-block;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:5px 18px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#fff;margin-bottom:22px;">${emoji} ${safeCategory}</div>
      <h1 style="margin:0 0 10px;font-size:30px;font-weight:900;color:#FFFFFF;">Hi ${safeName}! 👋</h1>
      <p style="margin:0 auto;font-size:15px;color:rgba(255,255,255,.72);max-width:420px;">${escapeHtml(safeTitle)}</p>
    </div>
  </div>
  <div style="background:#111827;border-left:1px solid rgba(255,255,255,.05);border-right:1px solid rgba(255,255,255,.05);">
    <div style="padding:32px 24px 24px;text-align:center;">
      <div style="display:inline-block;background:${rankGrad};border-radius:24px;padding:26px 52px;box-shadow:0 10px 40px rgba(0,0,0,.5);">
        <div style="font-size:44px;margin-bottom:6px;">${rankEmoji}</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.13em;color:rgba(255,255,255,.75);">Current Rank</div>
        ${rank != null ? `<div style="font-size:54px;font-weight:900;color:#fff;">#${rank}</div><div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:8px;">out of ${totalStudents} students</div>` : `<div style="font-size:26px;font-weight:800;color:rgba(255,255,255,.7);margin-top:4px;">Not ranked yet</div>`}
      </div>
    </div>
    <div style="padding:0 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${statCell("📊", String(Math.round(totalScore)), "Total Pts", "#F59E0B", "#1F2937")}
        ${statCell("✅", String(testsCompleted), "Tests Done", "#34D399", "#1F2937")}
        ${statCell("📈", `${pct}%`, "Avg Score", barColor, "#1F2937")}
        ${statCell(rank && rank <= 3 ? "🏆" : "🎯", rank != null ? `#${rank}` : "—", "Rank", "#A78BFA", "#1F2937")}
      </tr></table>
    </div>
    <div style="padding:0 24px 28px;">
      <div style="background:#1F2937;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;"><tr><td style="font-size:13px;font-weight:700;color:rgba(255,255,255,.85);">Overall Performance</td><td style="text-align:right;font-size:22px;font-weight:900;color:${barColor};">${pct}%</td></tr></table>
        <div style="background:rgba(255,255,255,.08);border-radius:999px;height:12px;overflow:hidden;"><div style="height:12px;border-radius:999px;background:linear-gradient(90deg,${barColor},${barGlow2});width:${pct}%;"></div></div>
      </div>
    </div>
    <div style="padding:0 24px 28px;">
      <div style="background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.22);border-left:4px solid #F59E0B;border-radius:0 16px 16px 0;padding:22px 24px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.13em;color:#F59E0B;margin-bottom:14px;">💬 Message from Admin</div>
        ${msgParas("rgba(255,255,255,.82)")}
      </div>
    </div>
    <div style="padding:0 24px 36px;text-align:center;">
      <a href="${safePortalUrl}" style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;text-decoration:none;padding:18px 48px;border-radius:18px;font-size:17px;font-weight:800;box-shadow:0 8px 24px rgba(245,158,11,.45);">Open My Dashboard →</a>
    </div>
  </div>
  ${sharedFooter("#0A0F1A")}
</div></body></html>`.trim();
}

/** Kept for backward-compat (test-email, non-personalized flows) */
export function buildBroadcastEmailHtml(args: {
  title: string; message: string; emoji: string; category: string; portalUrl: string;
}): string {
  return buildPersonalizedBroadcastEmailHtml({
    ...args,
    countdownDate: null,
    countdownLabel: "",
    stats: { name: "Student", rank: null, totalStudents: 0, totalScore: 0, testsCompleted: 0, avgPercentage: 0 },
  });
}

export async function sendBroadcastEmail({
  to,
  title,
  message,
  emoji,
  category,
  countdownDate,
  countdownLabel,
  stats,
}: {
  to: string;
  title: string;
  message: string;
  emoji: string;
  category: string;
  countdownDate: string | null;
  countdownLabel: string;
  stats: StudentEmailStats;
}) {
  const portalUrl = readPortalUrl();
  const htmlContent = buildPersonalizedBroadcastEmailHtml({
    title, message, emoji, category, portalUrl, countdownDate, countdownLabel, stats,
  });
  const personalised = message.replace(/\{name\}/gi, stats.name || "Student");
  const textContent = [
    `Hi ${stats.name}!`,
    "",
    title,
    "",
    personalised,
    "",
    `Your Rank: ${stats.rank != null ? `#${stats.rank}` : "Not ranked"}`,
    `Tests Completed: ${stats.testsCompleted}`,
    `Avg Score: ${Math.round(stats.avgPercentage)}%`,
    "",
    `Open Rank Pulse: ${portalUrl}`,
    "",
    "— Rank Pulse Admin Team",
  ].join("\n");
  await sendBrevoEmail({
    to,
    subject: title,
    htmlContent,
    textContent,
    messageType: "broadcast",
    metadata: { category, emoji, rank: stats.rank },
  });
}
