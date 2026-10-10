import { db, usersTable } from "@workspace/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { queuePendingStudentReviewEscalationEmail } from "./brevo";
import { logger } from "./logger";

const REVIEW_ESCALATION_AFTER_MS = 24 * 60 * 60 * 1000;
const REVIEW_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REVIEW_STARTUP_DELAY_MS = 45_000;

async function escalatePendingStudentReviews() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REVIEW_ESCALATION_AFTER_MS);

  const overdueStudents = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
      username: usersTable.username,
      subject: usersTable.subject,
      createdAt: usersTable.createdAt,
      pendingReviewStartedAt: usersTable.pendingReviewStartedAt,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "student"),
        eq(usersTable.status, "pending"),
        eq(usersTable.onboardingComplete, true),
        isNull(usersTable.pendingReviewEscalatedAt),
        or(
          lte(usersTable.pendingReviewStartedAt, cutoff),
          and(
            isNull(usersTable.pendingReviewStartedAt),
            lte(usersTable.createdAt, cutoff),
          ),
        ),
      ),
    );

  if (overdueStudents.length === 0) {
    return;
  }

  logger.info({ count: overdueStudents.length }, "Escalating overdue pending student reviews");

  for (const student of overdueStudents) {
    const reviewStartedAt = student.pendingReviewStartedAt ?? student.createdAt;

    queuePendingStudentReviewEscalationEmail({
      studentName: student.fullName,
      studentEmail: student.email,
      username: student.username,
      subject: student.subject,
      reviewStartedAt,
    });

    await db
      .update(usersTable)
      .set({
        pendingReviewStartedAt: reviewStartedAt,
        pendingReviewEscalatedAt: now,
      })
      .where(eq(usersTable.id, student.id));
  }
}

export function startPendingReviewScheduler() {
  setInterval(async () => {
    try {
      await escalatePendingStudentReviews();
    } catch (error) {
      logger.error({ error }, "Pending review scheduler error");
    }
  }, REVIEW_CHECK_INTERVAL_MS);

  setTimeout(async () => {
    try {
      await escalatePendingStudentReviews();
    } catch (error) {
      logger.error({ error }, "Pending review scheduler startup error");
    }
  }, REVIEW_STARTUP_DELAY_MS);
}
