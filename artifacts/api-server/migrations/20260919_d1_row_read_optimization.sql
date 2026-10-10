-- Evidence-based D1 row-read optimization.
-- This migration only adds lookup/order indexes and removes indexes that are
-- strict prefixes of existing composites. It does not alter or delete data.

-- Authentication and registration use lower(column) equality. Normal indexes
-- on email/username cannot be used for those expressions.
CREATE INDEX IF NOT EXISTS "users_lower_email_idx" ON "users" (lower("email"));
CREATE INDEX IF NOT EXISTS "users_lower_username_idx" ON "users" (lower("username"));

-- Admin/student lists filter by role and then order chronologically.
CREATE INDEX IF NOT EXISTS "users_role_created_at_id_idx" ON "users" ("role","created_at","id");

-- The published student test list filters by publication and orders by the
-- same COALESCE expression used by the API.
CREATE INDEX IF NOT EXISTS "tests_published_display_order_created_at_id_idx"
  ON "tests" ("is_published", COALESCE("display_order", 0), "created_at" DESC, "id");

-- Notification feeds, unread counts, and email log history are all scoped or
-- ordered by these columns.
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_id_idx"
  ON "notifications" ("user_id","created_at","id");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_id_idx"
  ON "notifications" ("user_id","is_read","id");
CREATE INDEX IF NOT EXISTS "email_send_logs_sent_at_id_idx"
  ON "email_send_logs" ("sent_at","id");

-- Admin activity/profile views count content by creator/teacher. These indexes
-- avoid scanning the complete question/report tables for each selected user.
CREATE INDEX IF NOT EXISTS "question_bank_questions_created_by_created_at_id_idx"
  ON "question_bank_questions" ("created_by","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_teacher_id_status_created_at_id_idx"
  ON "question_bank_reports" ("teacher_id","status","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_question_progress_student_id_class_id_id_idx"
  ON "question_bank_question_progress" ("student_id","class_id","id");

-- Exact replacements for redundant single-column indexes. The composite
-- indexes already cover the same equality predicates and additionally support
-- the endpoint's ordering/limit clauses.
DROP INDEX IF EXISTS "test_submissions_student_id_idx";
DROP INDEX IF EXISTS "test_submissions_test_id_idx";
DROP INDEX IF EXISTS "user_activity_logs_user_id_idx";
DROP INDEX IF EXISTS "user_sessions_user_id_idx";

ANALYZE;
