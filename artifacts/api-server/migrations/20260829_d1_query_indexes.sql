-- Query-plan-driven D1 index optimization. Safe to apply to a populated database.
-- It creates replacements before dropping the redundant single-column indexes.

CREATE INDEX IF NOT EXISTS "question_bank_question_progress_student_id_last_attempted_at_id_idx" ON "question_bank_question_progress" ("student_id","last_attempted_at","id");
CREATE INDEX IF NOT EXISTS "users_created_at_id_idx" ON "users" ("created_at","id");
CREATE INDEX IF NOT EXISTS "users_full_name_id_idx" ON "users" ("full_name","id");
CREATE INDEX IF NOT EXISTS "users_role_full_name_id_idx" ON "users" ("role","full_name","id");
CREATE INDEX IF NOT EXISTS "classes_workflow_type_title_id_idx" ON "classes" ("workflow_type","title","id");
CREATE INDEX IF NOT EXISTS "subjects_class_id_order_created_at_id_idx" ON "subjects" ("class_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "chapters_subject_id_order_created_at_id_idx" ON "chapters" ("subject_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "test_question_reports_test_id_reported_by_created_at_id_idx" ON "test_question_reports" ("test_id","reported_by","created_at","id");
CREATE INDEX IF NOT EXISTS "test_question_reports_reported_by_question_id_created_at_id_idx" ON "test_question_reports" ("reported_by","question_id","created_at","id");
CREATE INDEX IF NOT EXISTS "test_questions_test_id_order_id_idx" ON "test_questions" ("test_id","order","id");
CREATE INDEX IF NOT EXISTS "test_sections_test_id_order_id_idx" ON "test_sections" ("test_id","order","id");
CREATE INDEX IF NOT EXISTS "test_submissions_student_id_submitted_at_id_idx" ON "test_submissions" ("student_id","submitted_at","id");
CREATE INDEX IF NOT EXISTS "test_submissions_test_id_submitted_at_id_idx" ON "test_submissions" ("test_id","submitted_at","id");
CREATE INDEX IF NOT EXISTS "test_submissions_test_id_student_id_submitted_at_id_idx" ON "test_submissions" ("test_id","student_id","submitted_at","id");
CREATE INDEX IF NOT EXISTS "user_activity_logs_user_id_created_at_id_idx" ON "user_activity_logs" ("user_id","created_at","id");
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_last_active_at_id_idx" ON "user_sessions" ("user_id","last_active_at","id");
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_started_at_id_idx" ON "user_sessions" ("user_id","started_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_questions_class_id_order_created_at_id_idx" ON "question_bank_questions" ("class_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_questions_chapter_id_order_created_at_id_idx" ON "question_bank_questions" ("chapter_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_questions_source_test_question_idx" ON "question_bank_questions" ("source_test_id","source_test_question_id");
CREATE INDEX IF NOT EXISTS "test_question_bank_links_test_id_question_idx" ON "test_question_bank_links" ("test_id","test_question_id","question_bank_question_id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_question_id_created_at_id_idx" ON "question_bank_reports" ("question_id","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_teacher_id_created_at_id_idx" ON "question_bank_reports" ("teacher_id","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_saved_questions_student_id_question_id_idx" ON "question_bank_saved_questions" ("student_id","question_id");
CREATE INDEX IF NOT EXISTS "question_bank_saved_questions_student_id_created_at_id_idx" ON "question_bank_saved_questions" ("student_id","created_at","id");
CREATE INDEX IF NOT EXISTS "email_send_logs_recipient_email_sent_at_id_idx" ON "email_send_logs" ("recipient_email","sent_at","id");

DROP INDEX IF EXISTS "test_submissions_student_id_idx";
DROP INDEX IF EXISTS "test_submissions_test_id_idx";
DROP INDEX IF EXISTS "user_activity_logs_user_id_idx";
DROP INDEX IF EXISTS "user_activity_logs_created_at_idx";
DROP INDEX IF EXISTS "user_sessions_user_id_idx";

ANALYZE;
