import { createHmac, timingSafeEqual } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readPublicAppUrl } from "./publicAppUrl";

export type StudentReviewRecipient = {
  reviewerId: number | null;
  reviewerName: string;
  reviewerEmail: string;
};

export type StudentReviewSummary = {
  studentName: string;
  username: string;
  studentEmail: string;
  phone: string;
  submittedAtLabel: string;
  targetExam: string;
  dateOfBirth: string;
  whatsappNumber: string;
  addressLine: string;
  classLevel: string;
  board: string;
  institutionName: string;
  universityName: string;
  targetYear: string;
  learningMode: string;
  learningProvider: string;
  hearAboutUs: string;
  avatarUrl: string | null;
};

const DEFAULT_SUPER_ADMIN_REVIEW_EMAIL = "Rankpulsee@gmail.com";
const DEFAULT_EMAIL_REJECTION_REASON = "Application rejected from super admin email review. Please update your profile details and resubmit for approval.";
const STUDENT_REVIEW_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readStudentReviewSigningSecret() {
  return readTrimmedEnv("STUDENT_REVIEW_EMAIL_ACTION_SECRET")
    || readTrimmedEnv("PASSWORD_RESET_LINK_SECRET")
    || readTrimmedEnv("BREVO_API_KEY")
    || "rank-pulse-student-review-secret";
}

function readSuperAdminReviewEmail() {
  return readTrimmedEnv("SUPER_ADMIN_REVIEW_EMAIL").toLowerCase() || DEFAULT_SUPER_ADMIN_REVIEW_EMAIL;
}

function parseStudentProfileData(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTrimmedRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function formatStudentReviewDate(value: Date | string | null | undefined) {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function joinFields(values: Array<string | null | undefined>, fallback: string) {
  const resolved = values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean);
  return resolved.length > 0 ? resolved.join(", ") : fallback;
}

export function getStudentReviewCycleAt(user: {
  pendingReviewStartedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) {
  const date = user.pendingReviewStartedAt ?? user.createdAt ?? new Date();
  const resolved = date instanceof Date ? date : new Date(date);
  return Number.isNaN(resolved.getTime()) ? Date.now() : resolved.getTime();
}

export function createStudentReviewActionSignature({
  studentId,
  reviewerId,
  action,
  expiresAt,
  cycleAt,
}: {
  studentId: number;
  reviewerId: number | null;
  action: "approve" | "reject";
  expiresAt: number;
  cycleAt: number;
}) {
  return createHmac("sha256", readStudentReviewSigningSecret())
    .update(`${studentId}:${reviewerId ?? "none"}:${action}:${expiresAt}:${cycleAt}`)
    .digest("hex");
}

export function isStudentReviewActionSignatureValid({
  studentId,
  reviewerId,
  action,
  expiresAt,
  cycleAt,
  sig,
}: {
  studentId: number;
  reviewerId: number | null;
  action: "approve" | "reject";
  expiresAt: number;
  cycleAt: number;
  sig: string;
}) {
  if (!sig || !Number.isFinite(studentId) || !Number.isFinite(expiresAt) || !Number.isFinite(cycleAt)) {
    return false;
  }
  const expected = createStudentReviewActionSignature({ studentId, reviewerId, action, expiresAt, cycleAt });
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(sig, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function buildStudentReviewActionUrl({
  studentId,
  reviewerId,
  action,
  cycleAt,
}: {
  studentId: number;
  reviewerId: number | null;
  action: "approve" | "reject";
  cycleAt: number;
}) {
  const expiresAt = Date.now() + STUDENT_REVIEW_ACTION_TTL_MS;
  const sig = createStudentReviewActionSignature({ studentId, reviewerId, action, expiresAt, cycleAt });
  const url = new URL("/api/student-review/email-action", readPublicAppUrl());
  url.searchParams.set("studentId", String(studentId));
  url.searchParams.set("action", action);
  url.searchParams.set("expiresAt", String(expiresAt));
  url.searchParams.set("cycleAt", String(cycleAt));
  url.searchParams.set("sig", sig);
  if (reviewerId != null) {
    url.searchParams.set("reviewerId", String(reviewerId));
  }
  return url.toString();
}

export async function listStudentReviewEmailRecipients(): Promise<StudentReviewRecipient[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "super_admin"));

  const reviewEmail = readSuperAdminReviewEmail();
  const primaryReviewer = rows[0];

  if (primaryReviewer) {
    return [{
      reviewerId: primaryReviewer.id,
      reviewerName: primaryReviewer.fullName?.trim() || "Super Admin",
      reviewerEmail: reviewEmail,
    }];
  }

  return [{
    reviewerId: null,
    reviewerName: "Super Admin",
    reviewerEmail: reviewEmail,
  }];
}

export function buildStudentReviewSummary(user: {
  fullName: string;
  username: string;
  email: string;
  phone?: string | null;
  subject?: string | null;
  studentProfileData?: string | null;
  pendingReviewStartedAt?: Date | string | null;
  createdAt?: Date | string | null;
  avatarUrl?: string | null;
}): StudentReviewSummary {
  const profile = parseStudentProfileData(user.studentProfileData ?? null);
  const address = profile?.address && typeof profile.address === "object" ? profile.address as Record<string, unknown> : {};
  const preparation = profile?.preparation && typeof profile.preparation === "object" ? profile.preparation as Record<string, unknown> : {};
  const learningMode = profile?.learningMode && typeof profile.learningMode === "object" ? profile.learningMode as Record<string, unknown> : {};

  const targetExam = readTrimmedRecordValue(preparation, "targetExam") || user.subject?.trim() || "Not selected";
  const board = readTrimmedRecordValue(preparation, "board") || "Not provided";
  const classLevelRaw = readTrimmedRecordValue(preparation, "classLevel");
  const classLevelLegacyMap: Record<string, string> = {
    "College 1st Year": "Clg 1st",
    "College 2nd Year": "Clg 2nd",
    "College 3rd Year": "Clg 3rd",
    "College 4th Year": "Clg 4th",
    Graduate: "Graduated",
  };
  const classLevel = classLevelLegacyMap[classLevelRaw] ?? (classLevelRaw || "Not provided");
  const collegeStages = new Set(["Clg 1st", "Clg 2nd", "Clg 3rd", "Clg 4th", "Graduated", "College 1st Year", "College 2nd Year", "College 3rd Year", "College 4th Year", "Graduate"]);
  const isCollegeStage = collegeStages.has(classLevel) || board === "UG University";
  const rawInstitutionName = readTrimmedRecordValue(preparation, "institutionName");
  const rawCollegeName = readTrimmedRecordValue(preparation, "collegeName");
  const institutionName = rawCollegeName || rawInstitutionName || "Not provided";
  const universityName = isCollegeStage
    ? (readTrimmedRecordValue(preparation, "universityName") || "Not provided")
    : "Not applicable";
  const learningModeName = readTrimmedRecordValue(learningMode, "mode") || "Not provided";
  const learningProvider = readTrimmedRecordValue(learningMode, "provider") || "Not provided";

  return {
    studentName: user.fullName?.trim() || "Student",
    username: user.username?.trim() || "unknown",
    studentEmail: user.email?.trim() || "Not available",
    phone: user.phone?.trim() || "Not provided",
    submittedAtLabel: formatStudentReviewDate(user.pendingReviewStartedAt ?? user.createdAt),
    targetExam,
    dateOfBirth: profile && typeof profile.dateOfBirth === "string" && profile.dateOfBirth.trim() ? profile.dateOfBirth.trim() : "Not provided",
    whatsappNumber: profile && typeof profile.whatsappNumber === "string" && profile.whatsappNumber.trim()
      ? profile.whatsappNumber.trim()
      : (profile?.whatsappOnSameNumber === true ? user.phone?.trim() || "Not provided" : "Not provided"),
    addressLine: joinFields(
      [
        readTrimmedRecordValue(address, "street"),
        readTrimmedRecordValue(address, "district"),
        readTrimmedRecordValue(address, "city"),
        readTrimmedRecordValue(address, "state"),
        readTrimmedRecordValue(address, "country"),
        readTrimmedRecordValue(address, "pincode"),
      ],
      "Not provided",
    ),
    classLevel,
    board,
    institutionName,
    universityName,
    targetYear: readTrimmedRecordValue(preparation, "targetYear") || "Not provided",
    learningMode: learningModeName,
    learningProvider,
    hearAboutUs: profile && typeof profile.hearAboutUs === "string" && profile.hearAboutUs.trim()
      ? profile.hearAboutUs.trim()
      : "Not provided",
    avatarUrl: user.avatarUrl?.trim() || null,
  };
}

export function getDefaultEmailRejectionReason() {
  return DEFAULT_EMAIL_REJECTION_REASON;
}
