import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPlatformSettings } from "../lib/platformSettings";
import {
  getStudentReviewCycleAt,
  isStudentReviewActionSignatureValid,
} from "../lib/studentReview";
import { queueStudentApprovedEmail, queueStudentRejectedEmail } from "../lib/brevo";
import { readPublicAppUrl } from "../lib/publicAppUrl";

const router: IRouter = Router();

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

type EmailReviewAction = "approve" | "reject";

function readActionInput(source: Record<string, unknown>): {
  studentId: number;
  reviewerId: number | null;
  action: EmailReviewAction | null;
  expiresAt: number;
  cycleAt: number;
  sig: string;
  reason: string;
} {
  const studentId = Number(source.studentId);
  const reviewerId = toOptionalNumber(source.reviewerId);
  const action: EmailReviewAction | null = source.action === "approve" || source.action === "reject" ? source.action : null;
  const expiresAt = Number(source.expiresAt);
  const cycleAt = Number(source.cycleAt);
  const sig = typeof source.sig === "string" ? source.sig.trim() : "";
  const reason = typeof source.reason === "string" ? source.reason.trim() : "";

  return {
    studentId,
    reviewerId,
    action,
    expiresAt,
    cycleAt,
    sig,
    reason,
  };
}

function renderStudentReviewResultPage({
  title,
  message,
  tone,
  meta,
}: {
  title: string;
  message: string;
  tone: "success" | "warning" | "error";
  meta?: string | null;
}) {
  const theme = tone === "success"
    ? {
        badge: "#16a34a",
        button: "#15803d",
        border: "#bbf7d0",
        surface: "#f0fdf4",
      }
    : tone === "warning"
      ? {
          badge: "#d97706",
          button: "#b45309",
          border: "#fed7aa",
          surface: "#fff7ed",
        }
      : {
          badge: "#dc2626",
          button: "#b91c1c",
          border: "#fecaca",
          surface: "#fff1f2",
      };
  const dashboardUrl = new URL("/super-admin/students", readPublicAppUrl()).toString();
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeMeta = meta ? escapeHtml(meta) : "";
  const safeDashboardUrl = escapeHtml(dashboardUrl);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${theme.border};border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
          <div style="padding:24px 28px;background:linear-gradient(135deg,#fff7e8 0%,#ffedd5 100%);border-bottom:1px solid ${theme.border};">
            <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${theme.badge};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
              Student Review
            </div>
            <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">${safeTitle}</h1>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#4b5563;">${safeMessage}</p>
          </div>
          <div style="padding:28px;">
          <div style="border:1px solid ${theme.border};border-radius:18px;background:${theme.surface};padding:18px 20px;">
            <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
              You can close this tab now, or open the super admin dashboard to review other students.
            </p>
            ${meta ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">${safeMeta}</p>` : ""}
          </div>
            <div style="margin-top:24px;">
              <a href="${safeDashboardUrl}" style="display:inline-block;background:${theme.button};color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;">
                Open Super Admin Dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `.trim();
}

async function getReviewerName(reviewedById: number | null | undefined) {
  if (!reviewedById) return null;
  const [reviewer] = await db
    .select({ fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, reviewedById));
  if (!reviewer) return null;
  return reviewer.fullName?.trim() || (reviewer.role === "super_admin" ? "Super Admin" : "Admin");
}

function renderRejectReasonFormPage({
  studentName,
  reviewerName,
  message,
  error,
  reason,
  studentId,
  reviewerId,
  expiresAt,
  cycleAt,
  sig,
}: {
  studentName: string;
  reviewerName: string | null;
  message?: string | null;
  error?: string | null;
  reason?: string;
  studentId: number;
  reviewerId: number | null;
  expiresAt: number;
  cycleAt: number;
  sig: string;
}) {
  const safeStudentName = escapeHtml(studentName);
  const safeReviewerName = escapeHtml(reviewerName?.trim() || "Super Admin");
  const safeMessage = message ? escapeHtml(message) : "";
  const safeError = error ? escapeHtml(error) : "";
  const safeReason = escapeHtml(reason ?? "");
  const dashboardUrl = escapeHtml(new URL("/super-admin/students", readPublicAppUrl()).toString());

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Reject Student</title>
      </head>
      <body style="margin:0;background:#fff7e8;padding:32px 16px;font-family:Arial,sans-serif;color:#1f2937;">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #fecaca;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
          <div style="padding:24px 28px;background:linear-gradient(135deg,#fff1f2 0%,#ffe4e6 100%);border-bottom:1px solid #fecaca;">
            <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#dc2626;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">
              Reject Student
            </div>
            <h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;color:#111827;">Add custom rejection reason</h1>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#4b5563;">
              ${safeReviewerName}, share a short reason before rejecting ${safeStudentName}. This message will be emailed to the student.
            </p>
          </div>
          <div style="padding:28px;">
            <div style="border:1px solid #fecaca;border-radius:18px;background:#fff1f2;padding:18px 20px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
                The email link stays valid only for this review cycle. If the student is already reviewed from the portal, this form will stop working automatically.
              </p>
              ${message ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">${safeMessage}</p>` : ""}
            </div>
            ${error ? `<div style="margin-top:18px;border:1px solid #fecaca;border-radius:14px;background:#fff1f2;padding:14px 16px;color:#b91c1c;font-size:14px;font-weight:700;">${safeError}</div>` : ""}
            <form method="post" action="/api/student-review/email-action" style="margin-top:20px;">
              <input type="hidden" name="studentId" value="${studentId}" />
              <input type="hidden" name="action" value="reject" />
              <input type="hidden" name="expiresAt" value="${expiresAt}" />
              <input type="hidden" name="cycleAt" value="${cycleAt}" />
              <input type="hidden" name="sig" value="${escapeHtml(sig)}" />
              ${reviewerId != null ? `<input type="hidden" name="reviewerId" value="${reviewerId}" />` : ""}
              <label for="reason" style="display:block;margin-bottom:10px;font-size:14px;font-weight:700;color:#111827;">
                Rejection reason
              </label>
              <textarea
                id="reason"
                name="reason"
                rows="7"
                required
                minlength="5"
                placeholder="Example: Your district, target exam, and academic details do not match. Please correct them and submit again."
                style="width:100%;box-sizing:border-box;padding:16px 18px;border-radius:16px;border:1px solid #fca5a5;font:inherit;line-height:1.6;color:#111827;resize:vertical;outline:none;"
              >${safeReason}</textarea>
              <div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:12px;">
                <button type="submit" style="border:none;background:#b91c1c;color:#ffffff;padding:14px 22px;border-radius:14px;font-weight:700;cursor:pointer;">
                  Reject Student
                </button>
                <a href="${dashboardUrl}" style="display:inline-block;background:#ffffff;color:#374151;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:700;border:1px solid #e5e7eb;">
                  Open Dashboard Instead
                </a>
              </div>
            </form>
          </div>
        </div>
      </body>
    </html>
  `.trim();
}

router.get("/student-review/email-action", async (req, res): Promise<void> => {
  const { studentId, reviewerId, action, expiresAt, cycleAt, sig } = readActionInput(req.query as Record<string, unknown>);

  if (!action || !Number.isInteger(studentId) || !Number.isFinite(expiresAt) || !Number.isFinite(cycleAt)) {
    res.status(400).send(renderStudentReviewResultPage({
      title: "Invalid review link",
      message: "This email review link is incomplete or malformed.",
      tone: "error",
    }));
    return;
  }

  if (Date.now() > expiresAt) {
    res.status(410).send(renderStudentReviewResultPage({
      title: "Review link expired",
      message: "This email action link has expired. Please use the super admin dashboard or wait for a new review email.",
      tone: "warning",
    }));
    return;
  }

  if (!isStudentReviewActionSignatureValid({ studentId, reviewerId, action, expiresAt, cycleAt, sig })) {
    res.status(403).send(renderStudentReviewResultPage({
      title: "Signature mismatch",
      message: "This email action link is no longer valid.",
      tone: "error",
    }));
    return;
  }

  const settings = await getPlatformSettings();
  if (!settings.studentReviewEmailActionsEnabled) {
    res.status(423).send(renderStudentReviewResultPage({
      title: "Email quick actions disabled",
      message: "Super admin email quick actions are currently turned off. Please review the student from the dashboard instead.",
      tone: "warning",
    }));
    return;
  }

  const reviewerName = await getReviewerName(reviewerId);
  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, studentId));

  if (!student || student.role !== "student" || !student.onboardingComplete) {
    res.status(404).send(renderStudentReviewResultPage({
      title: "Student not found",
      message: "This student profile is no longer available for email review.",
      tone: "error",
    }));
    return;
  }

  if (student.status !== "pending") {
    const tone = student.status === "approved" ? "success" : "warning";
    const statusLabel = student.status === "approved" ? "approved" : student.status;
    const reviewerName = await getReviewerName(student.reviewedById);
    res.status(409).send(renderStudentReviewResultPage({
      title: "Already reviewed",
      message: `${student.fullName} is already marked as ${statusLabel}. Use the dashboard if you need to change the status again.`,
      tone,
      meta: reviewerName ? `Reviewed from the portal by ${reviewerName}.` : null,
    }));
    return;
  }

  if (getStudentReviewCycleAt(student) !== cycleAt) {
    res.status(409).send(renderStudentReviewResultPage({
      title: "Review cycle changed",
      message: "This student has already resubmitted updated details. Please use the latest review email or open the dashboard.",
      tone: "warning",
    }));
    return;
  }

  if (action === "reject") {
    res.send(renderRejectReasonFormPage({
      studentName: student.fullName,
      reviewerName,
      message: `You are reviewing ${student.fullName}. Submit the rejection reason to complete the action.`,
      studentId,
      reviewerId,
      expiresAt,
      cycleAt,
      sig,
    }));
    return;
  }

  const [reviewed] = await db
    .update(usersTable)
    .set({
      status: action === "approve" ? "approved" : "rejected",
      reviewedById: reviewerId ?? null,
      reviewedAt: new Date(),
      approvedById: action === "approve" && reviewerId ? reviewerId : null,
      approvedAt: action === "approve" ? new Date() : null,
      rejectionReason: null,
      pendingReviewStartedAt: null,
      pendingReviewEscalatedAt: null,
    })
    .where(eq(usersTable.id, studentId))
    .returning();

  if (!reviewed) {
    res.status(404).send(renderStudentReviewResultPage({
      title: "Review unavailable",
      message: "The student record could not be updated.",
      tone: "error",
    }));
    return;
  }

  if (action === "approve") {
    if (reviewed.email) {
      queueStudentApprovedEmail({
        studentName: reviewed.fullName,
        email: reviewed.email,
      });
    }
    res.send(renderStudentReviewResultPage({
      title: "Student approved",
      message: `${reviewed.fullName} has been approved directly from the review email.`,
      tone: "success",
    }));
    return;
  }
});

router.post("/student-review/email-action", async (req, res): Promise<void> => {
  const { studentId, reviewerId, action, expiresAt, cycleAt, sig, reason } = readActionInput(req.body as Record<string, unknown>);

  if (action !== "reject" || !Number.isInteger(studentId) || !Number.isFinite(expiresAt) || !Number.isFinite(cycleAt)) {
    res.status(400).send(renderStudentReviewResultPage({
      title: "Invalid review form",
      message: "This rejection form is incomplete or malformed.",
      tone: "error",
    }));
    return;
  }

  const reviewerName = await getReviewerName(reviewerId);

  if (Date.now() > expiresAt) {
    res.status(410).send(renderStudentReviewResultPage({
      title: "Review link expired",
      message: "This email review form has expired. Please use the super admin dashboard or wait for a new review email.",
      tone: "warning",
    }));
    return;
  }

  if (!isStudentReviewActionSignatureValid({ studentId, reviewerId, action, expiresAt, cycleAt, sig })) {
    res.status(403).send(renderStudentReviewResultPage({
      title: "Signature mismatch",
      message: "This email rejection form is no longer valid.",
      tone: "error",
    }));
    return;
  }

  const settings = await getPlatformSettings();
  if (!settings.studentReviewEmailActionsEnabled) {
    res.status(423).send(renderStudentReviewResultPage({
      title: "Email quick actions disabled",
      message: "Super admin email quick actions are currently turned off. Please review the student from the dashboard instead.",
      tone: "warning",
    }));
    return;
  }

  const [student] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, studentId));

  if (!student || student.role !== "student" || !student.onboardingComplete) {
    res.status(404).send(renderStudentReviewResultPage({
      title: "Student not found",
      message: "This student profile is no longer available for email review.",
      tone: "error",
    }));
    return;
  }

  if (student.status !== "pending") {
    const tone = student.status === "approved" ? "success" : "warning";
    const statusLabel = student.status === "approved" ? "approved" : student.status;
    const actedByName = await getReviewerName(student.reviewedById);
    res.status(409).send(renderStudentReviewResultPage({
      title: "Already reviewed",
      message: `${student.fullName} is already marked as ${statusLabel}. Use the dashboard if you need to change the status again.`,
      tone,
      meta: actedByName ? `Reviewed from the portal by ${actedByName}.` : null,
    }));
    return;
  }

  if (getStudentReviewCycleAt(student) !== cycleAt) {
    res.status(409).send(renderStudentReviewResultPage({
      title: "Review cycle changed",
      message: "This student has already resubmitted updated details. Please use the latest review email or open the dashboard.",
      tone: "warning",
    }));
    return;
  }

  if (reason.length < 5) {
    res.status(400).send(renderRejectReasonFormPage({
      studentName: student.fullName,
      reviewerName,
      error: "Please enter at least 5 characters for the rejection reason.",
      reason,
      studentId,
      reviewerId,
      expiresAt,
      cycleAt,
      sig,
    }));
    return;
  }

  const [reviewed] = await db
    .update(usersTable)
    .set({
      status: "rejected",
      reviewedById: reviewerId ?? null,
      reviewedAt: new Date(),
      approvedById: null,
      approvedAt: null,
      rejectionReason: reason,
      pendingReviewStartedAt: null,
      pendingReviewEscalatedAt: null,
    })
    .where(eq(usersTable.id, studentId))
    .returning();

  if (!reviewed) {
    res.status(404).send(renderStudentReviewResultPage({
      title: "Review unavailable",
      message: "The student record could not be updated.",
      tone: "error",
    }));
    return;
  }

  if (reviewed.email) {
    queueStudentRejectedEmail({
      studentName: reviewed.fullName,
      email: reviewed.email,
      reason,
    });
  }

  res.send(renderStudentReviewResultPage({
    title: "Student rejected",
    message: `${reviewed.fullName} has been rejected from the email review flow. The student can update details and resubmit later.`,
    tone: "warning",
    meta: reviewerName ? `Saved rejection reason from ${reviewerName}.` : null,
  }));
});

export default router;
