/**
 * Daily Student-Data Backup Scheduler
 * Every day at 2 AM: exports all student accounts + their data,
 * emails it to the super admin as a gzip attachment importable via
 * Super Admin → Data Transfer → Import.
 */
import { logger } from "./logger";
import { buildStudentOnlyExport } from "../routes/dataTransfer";
import nodemailer from "nodemailer";
import { gzip } from "zlib";
import { promisify } from "util";
import { ensureRankPulseEmailLayout } from "./rankPulseEmail";

const gzipAsync = promisify(gzip);

const SUPER_ADMIN_EMAIL = process.env["BACKUP_EMAIL"] || process.env["GMAIL_USER"] || process.env["SMTP_USER"] || "rankpulsee@gmail.com";
const GMAIL_SENDER_NAME = "Rank Pulse";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB compressed limit

function getGmailConfig() {
  const user = (process.env["GMAIL_USER"] ?? process.env["SMTP_USER"] ?? "").trim();
  const pass = (process.env["GMAIL_APP_PASSWORD"] ?? process.env["SMTP_PASS"] ?? "").trim();
  if (!user || !pass) return null;
  return { user, pass };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendStudentBackupEmail(jsonPayload: string, filename: string) {
  const config = getGmailConfig();
  if (!config) {
    logger.warn("exportScheduler: GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping email");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const rawBytes = Buffer.byteLength(jsonPayload, "utf8");
  const rawKb   = Math.round(rawBytes / 1024);

  let attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  let bodySuffix = "";

  try {
    const compressed = await gzipAsync(Buffer.from(jsonPayload, "utf8"));
    const compressedKb = Math.round(compressed.byteLength / 1024);

    if (compressed.byteLength <= MAX_ATTACHMENT_BYTES) {
      attachments = [{
        filename: filename.replace(/\.json$/, ".json.gz"),
        content:  compressed,
        contentType: "application/gzip",
      }];
      bodySuffix = `<p style="color:#059669;font-size:13px;margin-top:12px">
        📎 Backup attached as <strong>${filename.replace(/\.json$/, ".json.gz")}</strong>
        (${compressedKb.toLocaleString()} KB compressed · ${rawKb.toLocaleString()} KB original)
      </p>
      <p style="color:#475569;font-size:13px;margin-top:8px;padding:10px 14px;background:#f1f5f9;border-radius:8px;border-left:3px solid #6366f1">
        💡 <strong>To import:</strong> Go to Super Admin → Data Transfer → Import → upload this <code>.json.gz</code> file (decompress first if needed).
      </p>`;
      logger.info({ compressedKb, rawKb }, "exportScheduler: Compressed student backup ready to attach");
    } else {
      bodySuffix = `<p style="color:#d97706;font-size:13px;margin-top:12px;padding:12px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a">
        ⚠️ Backup too large to attach (${rawKb.toLocaleString()} KB · ${compressedKb.toLocaleString()} KB compressed).<br/>
        Download manually from <strong>Super Admin → Data Transfer</strong>.
      </p>`;
      logger.warn({ compressedKb, rawKb }, "exportScheduler: Backup too large for email — sending summary only");
    }
  } catch (compressErr) {
    logger.error({ err: compressErr }, "exportScheduler: Compression failed");
    bodySuffix = `<p style="color:#ef4444;font-size:13px;margin-top:12px">
      ❌ Compression failed. Download manually from the Super Admin dashboard.
    </p>`;
  }

  // Parse export metadata and progress rows for the email summary.
  let payload: any = {};
  try { payload = JSON.parse(jsonPayload) ?? {}; } catch { /* ignore */ }
  const meta = payload.meta ?? {};

  const statsRows = Object.entries(meta)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;font-size:13px">${escapeHtml(v)}</td></tr>`)
    .join("");

  const students = Array.isArray(payload.students) ? payload.students : [];
  const testSubmissions = Array.isArray(payload.progress?.testSubmissions)
    ? payload.progress.testSubmissions
    : [];
  const questionBankProgress = Array.isArray(payload.progress?.questionBankProgress)
    ? payload.progress.questionBankProgress
    : [];
  const questionBankSaved = Array.isArray(payload.progress?.questionBankSaved)
    ? payload.progress.questionBankSaved
    : [];

  const testStats = new Map<number, { count: number; percentageTotal: number }>();
  for (const submission of testSubmissions) {
    const studentId = Number(submission.studentId);
    if (!Number.isFinite(studentId)) continue;
    const current = testStats.get(studentId) ?? { count: 0, percentageTotal: 0 };
    current.count += 1;
    current.percentageTotal += Number(submission.percentage) || 0;
    testStats.set(studentId, current);
  }

  const questionBankStats = new Map<number, { questions: number; attempts: number; correct: number }>();
  for (const progress of questionBankProgress) {
    const studentId = Number(progress.studentId);
    if (!Number.isFinite(studentId)) continue;
    const current = questionBankStats.get(studentId) ?? { questions: 0, attempts: 0, correct: 0 };
    current.questions += 1;
    current.attempts += Number(progress.attemptCount) || 0;
    current.correct += Number(progress.correctCount) || 0;
    questionBankStats.set(studentId, current);
  }

  const savedQuestionStats = new Map<number, number>();
  for (const saved of questionBankSaved) {
    const studentId = Number(saved.studentId);
    if (!Number.isFinite(studentId)) continue;
    savedQuestionStats.set(studentId, (savedQuestionStats.get(studentId) ?? 0) + 1);
  }

  const progressRows = [...students]
    .sort((a, b) => String(a.fullName ?? a.username ?? "").localeCompare(String(b.fullName ?? b.username ?? "")))
    .map((student) => {
      const studentId = Number(student.id);
      const test = testStats.get(studentId) ?? { count: 0, percentageTotal: 0 };
      const questionBank = questionBankStats.get(studentId) ?? { questions: 0, attempts: 0, correct: 0 };
      const accuracy = questionBank.attempts > 0
        ? Math.round((questionBank.correct / questionBank.attempts) * 1000) / 10
        : 0;
      const averageScore = test.count > 0
        ? Math.round((test.percentageTotal / test.count) * 10) / 10
        : 0;

      return `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:12px;font-weight:600">${escapeHtml(student.fullName || student.username || "Student")}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px">${escapeHtml(student.email || "—")}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:12px;text-align:center">${test.count}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:12px;text-align:center">${averageScore}%</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:12px;text-align:center">${questionBank.questions}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:12px;text-align:center">${accuracy}%</td>
        <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:12px;text-align:center">${savedQuestionStats.get(studentId) ?? 0}</td>
      </tr>`;
    })
    .join("");

  const progressSection = `
    <div style="margin:24px 0 8px">
      <h2 style="margin:0 0 6px;color:#0f172a;font-size:17px">Student Progress Snapshot</h2>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;line-height:1.5">
        Test Progress shows tests attempted and average score. Question Bank Progress shows unique questions attempted, answer accuracy, and saved questions.
      </p>
      ${progressRows
        ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <thead><tr style="background:#f8fafc">
            <th style="padding:9px 8px;text-align:left;color:#64748b;font-size:11px">Student</th>
            <th style="padding:9px 8px;text-align:left;color:#64748b;font-size:11px">Email</th>
            <th style="padding:9px 8px;text-align:center;color:#64748b;font-size:11px">Tests</th>
            <th style="padding:9px 8px;text-align:center;color:#64748b;font-size:11px">Avg score</th>
            <th style="padding:9px 8px;text-align:center;color:#64748b;font-size:11px">QB attempted</th>
            <th style="padding:9px 8px;text-align:center;color:#64748b;font-size:11px">QB accuracy</th>
            <th style="padding:9px 8px;text-align:center;color:#64748b;font-size:11px">QB saved</th>
          </tr></thead>
          <tbody>${progressRows}</tbody>
        </table></div>`
        : `<p style="padding:12px;background:#f8fafc;border-radius:8px;color:#64748b;font-size:13px">No student progress has been recorded yet.</p>`}
    </div>`;

  const htmlContent = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:16px;padding:24px;color:#fff;margin-bottom:24px">
        <h1 style="margin:0;font-size:22px;font-weight:800">🎓 Daily Student Backup</h1>
        <p style="margin:8px 0 0;opacity:.85;font-size:14px">${dateStr}</p>
      </div>
      <p style="color:#334155;font-size:15px;line-height:1.6">
        Hi Admin,<br/><br/>
        Your <strong>daily student data backup</strong> for Rank Pulse is ready.
        This file contains all student accounts (with credentials) and their activity,
         along with each student's test and question bank progress. It can be re-imported
         to restore student data on any fresh instance.
      </p>
      ${statsRows ? `<table style="margin:16px 0;border-collapse:collapse">${statsRows}</table>` : ""}
       ${progressSection}
      ${bodySuffix}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="color:#94a3b8;font-size:12px">Rank Pulse · Auto-generated daily student backup · Store securely</p>
    </div>
  `.trim();

  const textContent = [
    `Daily Student Backup – ${dateStr}`,
    "",
    `Progress included: ${testSubmissions.length} test submissions, ${questionBankProgress.length} question bank progress records, ${questionBankSaved.length} saved questions.`,
    "",
    attachments.length > 0
      ? `Attached: ${attachments[0].filename}`
      : "Backup too large — download from Super Admin → Data Transfer.",
    "",
    "Team Rank Pulse",
  ].join("\n");

  await transporter.sendMail({
    from:    `"${GMAIL_SENDER_NAME}" <${config.user}>`,
    to:      SUPER_ADMIN_EMAIL,
    subject: `🎓 Daily Student Backup – ${dateStr}`,
    html:    ensureRankPulseEmailLayout(htmlContent, `Daily Student Backup – ${dateStr}`, "Data backup"),
    text:    textContent,
    attachments,
  });

  logger.info(
    { recipient: SUPER_ADMIN_EMAIL, filename, attached: attachments.length > 0, rawKb },
    "exportScheduler: Student backup email sent via Gmail SMTP"
  );
}

async function runDailyStudentExport() {
  logger.info("exportScheduler: Starting daily student export…");
  try {
    // Include passwords so the backup is fully importable
    const payload = await buildStudentOnlyExport();
    const json     = JSON.stringify(payload);
    const date     = new Date().toISOString().slice(0, 10);
    const filename  = `rankpulse-students-${date}.json`;
    const sizeKb   = Math.round(Buffer.byteLength(json, "utf8") / 1024);
    logger.info({ sizeKb, students: payload.meta.count }, "exportScheduler: Student export built");
    await sendStudentBackupEmail(json, filename);
    logger.info("exportScheduler: Daily student export complete");
  } catch (err) {
    logger.error({ err }, "exportScheduler: Daily student export failed");
  }
}

export function startExportScheduler() {
  const config = getGmailConfig();
  if (!config) {
    logger.warn("exportScheduler: No Gmail SMTP configured — daily backup emails disabled");
    return;
  }

  logger.info("exportScheduler: Started — daily student backup every day at 2 AM");

  function scheduleNext() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    // If it's already past 2 AM today, schedule for tomorrow
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    logger.info(
      { nextRun: next.toISOString(), delayHours: Math.round(delay / 3_600_000) },
      "exportScheduler: Next student backup scheduled"
    );
    setTimeout(async () => {
      await runDailyStudentExport();
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

/** Trigger an immediate student backup email (callable from the API) */
export async function triggerManualExportEmail(): Promise<{ filename: string; sizeKb: number }> {
  const payload  = await buildStudentOnlyExport();
  const json     = JSON.stringify(payload);
  const date     = new Date().toISOString().slice(0, 10);
  const filename  = `rankpulse-students-manual-${date}.json`;
  const sizeKb   = Math.round(Buffer.byteLength(json, "utf8") / 1024);
  await sendStudentBackupEmail(json, filename);
  return { filename, sizeKb };
}
