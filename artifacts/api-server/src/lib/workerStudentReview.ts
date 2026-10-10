type ReviewStatement = {
  bind(...values: unknown[]): ReviewStatement;
  first<T>(): Promise<T | null>;
};
type ReviewEnv = {
  DB: { prepare(sql: string): ReviewStatement };
  STUDENT_REVIEW_EMAIL_ACTION_SECRET?: string;
  GMAIL_APP_PASSWORD?: string;
};

export type ReviewRecipient = { reviewerId: number | null; reviewerName: string; email: string };
type ReviewAction = "approve" | "reject";
type ReviewToken = { studentId: number; reviewerId: number | null; email: string; action: ReviewAction; cycleAt: number; expiresAt: number };
const ACTION_PATH = "/api/student-review/email-action";
const TTL = 7 * 24 * 60 * 60 * 1000;

function escape(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function signingKey(env: ReviewEnv) {
  const secret = env.STUDENT_REVIEW_EMAIL_ACTION_SECRET?.trim() || env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!secret) throw new Error("Student review email signing secret is not configured.");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function tokenBytes(token: ReviewToken) {
  return new TextEncoder().encode(JSON.stringify(["student-review-v1", token.studentId, token.reviewerId, token.email, token.action, token.cycleAt, token.expiresAt]));
}

export async function buildWorkerStudentReviewUrl(env: ReviewEnv, baseUrl: string, student: Record<string, unknown>, recipient: ReviewRecipient, action: ReviewAction) {
  const token: ReviewToken = {
    studentId: Number(student.id), reviewerId: recipient.reviewerId, email: recipient.email,
    action, cycleAt: Number(student.pending_review_started_at ?? student.created_at), expiresAt: Date.now() + TTL,
  };
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), tokenBytes(token));
  const url = new URL(ACTION_PATH, baseUrl);
  for (const [key, value] of Object.entries(token)) {
    if (value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("sig", Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  return url.toString();
}

function page(title: string, message: string, status = 200, form = "") {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | RankPulse</title></head>
    <body style="margin:0;padding:32px 16px;background:#fff7ed;font-family:Arial,sans-serif;color:#111827;line-height:1.6">
    <main style="max-width:580px;margin:auto;background:white;border:1px solid #fed7aa;border-radius:20px;padding:28px">
    <p style="color:#c2410c;font-weight:bold">RankPulse · Student Review</p><h1>${escape(title)}</h1><p>${escape(message)}</p>${form}
    </main></body></html>`, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  } });
}

function reviewForm(token: ReviewToken, sig: string, reason = "") {
  const fields = { ...token, sig };
  return `<form method="post" action="${ACTION_PATH}">
    ${Object.entries(fields).filter(([, value]) => value !== null).map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`).join("")}
    ${token.action === "reject" ? `<label for="reason"><strong>Rejection reason</strong></label><p style="font-size:14px">This reason will be shared with the student.</p><textarea id="reason" name="reason" required minlength="5" maxlength="2000" rows="5" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit">${escape(reason)}</textarea>` : ""}
    <button type="submit" style="margin-top:20px;padding:14px 22px;border:0;border-radius:10px;background:${token.action === "approve" ? "#15803d" : "#b91c1c"};color:white;font:inherit;font-weight:bold">${token.action === "approve" ? "Confirm Approval" : "Reject with Reason"}</button>
    <p style="font-size:13px;color:#6b7280">No portal login needed. You can close this page after submitting.</p></form>`;
}

export async function handleWorkerStudentReview(
  request: Request,
  env: ReviewEnv,
  recipients: () => Promise<ReviewRecipient[]>,
  onReviewed: (student: Record<string, unknown>, action: ReviewAction, reason: string) => void,
) {
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    return page("Method not allowed", "Open the review link from your email.", 405);
  }
  try {
    const values = request.method === "POST" ? await request.formData() : new URL(request.url).searchParams;
    const action = values.get("action");
    const studentId = Number(values.get("studentId"));
    const reviewerId = values.get("reviewerId") === null ? null : Number(values.get("reviewerId"));
    const cycleAt = Number(values.get("cycleAt"));
    const expiresAt = Number(values.get("expiresAt"));
    const email = values.get("email");
    const sig = values.get("sig");
    if ((action !== "approve" && action !== "reject") || !Number.isSafeInteger(studentId) || studentId <= 0
      || (reviewerId !== null && (!Number.isSafeInteger(reviewerId) || reviewerId <= 0))
      || !Number.isSafeInteger(cycleAt) || cycleAt <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
      || typeof email !== "string" || !email || typeof sig !== "string" || !/^[a-f0-9]{64}$/.test(sig)) {
      return page("Invalid review link", "Please use the complete link from the latest review email.", 400);
    }
    const token: ReviewToken = { studentId, reviewerId, email, action, cycleAt, expiresAt };
    const signature = Uint8Array.from(sig.match(/../g)!, (byte) => parseInt(byte, 16));
    if (!await crypto.subtle.verify("HMAC", await signingKey(env), signature, tokenBytes(token))) {
      return page("Invalid review link", "This review link is no longer valid. Please use the latest review email.", 403);
    }
    if (Date.now() > expiresAt) return page("Review link expired", "This link was valid for 7 days. Please use a newer review email or the dashboard.", 410);
    const settings = await env.DB.prepare("SELECT student_review_email_actions_enabled AS enabled FROM platform_settings WHERE id = 1").first<{ enabled: number }>();
    if (settings && !Number(settings.enabled)) return page("Email actions disabled", "Email quick actions are currently turned off in the super admin settings.", 423);
    if (!(await recipients()).some((recipient) => recipient.reviewerId === reviewerId && recipient.email === email)) {
      return page("Reviewer unavailable", "This email recipient is no longer authorized to review students.", 403);
    }
    const student = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(studentId).first<Record<string, unknown>>();
    if (!student || student.role !== "student" || !Number(student.onboarding_complete)) return page("Student unavailable", "This student has no submitted application to review.", 404);
    if (student.status !== "pending") return page("Already reviewed", `${student.full_name} is already marked as ${student.status}. You can close this page.`, 409);
    if (Number(student.pending_review_started_at ?? student.created_at) !== cycleAt) return page("Application updated", "The student has resubmitted their details. Please use the latest review email.", 409);

    // Mail scanners and previews follow GET links. Only an explicit form POST changes status.
    if (request.method !== "POST") return page(action === "approve" ? "Approve student" : "Reject student", `Reviewing ${student.full_name} (${student.email}).`, 200, reviewForm(token, sig));
    const rawReason = values.get("reason");
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (action === "reject" && (reason.length < 5 || reason.length > 2000)) {
      return page("Rejection reason required", "Please enter a reason between 5 and 2,000 characters.", 400, reviewForm(token, sig, reason.slice(0, 2000)));
    }
    const now = Date.now();
    const reviewed = await env.DB.prepare(`UPDATE users SET status = ?, rejection_reason = ?, reviewed_by_id = ?, reviewed_at = ?, approved_by_id = ?, approved_at = ?, pending_review_started_at = NULL, pending_review_escalated_at = NULL, updated_at = ?
      WHERE id = ? AND role = 'student' AND onboarding_complete = 1 AND status = 'pending' AND COALESCE(pending_review_started_at, created_at) = ? RETURNING *`)
      .bind(action === "approve" ? "approved" : "rejected", action === "reject" ? reason : null, reviewerId, now, action === "approve" ? reviewerId : null, action === "approve" ? now : null, now, studentId, cycleAt)
      .first<Record<string, unknown>>();
    if (!reviewed) return page("Review changed", "This application was already reviewed or updated. Please use the latest review email.", 409);
    onReviewed(reviewed, action, reason);
    return page(action === "approve" ? "Student approved" : "Student rejected", `${student.full_name} has been ${action === "approve" ? "approved" : "rejected with your reason"}. You can close this page now.`);
  } catch (error) {
    console.error("Student email review failed", error instanceof Error ? error.message : "Unknown error");
    return page("Review unavailable", "We could not complete this review. Please try again shortly.", 503);
  }
}
