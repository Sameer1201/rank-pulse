export const D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "question_bank_question_progress" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "question_id" integer NOT NULL,
  "student_id" integer NOT NULL,
  "class_id" integer NOT NULL,
  "subject_id" integer NOT NULL,
  "chapter_id" integer NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "correct_count" integer DEFAULT 0 NOT NULL,
  "incorrect_count" integer DEFAULT 0 NOT NULL,
  "last_answer" text,
  "last_is_correct" integer DEFAULT 0 NOT NULL,
  "first_attempted_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "last_attempted_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "solved_at" integer,
  FOREIGN KEY ("question_id") REFERENCES "question_bank_questions"("id") ON DELETE cascade,
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade,
  FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE cascade,
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade,
  FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "question_bank_question_progress_unique" ON "question_bank_question_progress" ("question_id","student_id");
CREATE INDEX IF NOT EXISTS "question_bank_question_progress_student_id_last_attempted_at_id_idx" ON "question_bank_question_progress" ("student_id","last_attempted_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_question_progress_student_id_class_id_id_idx" ON "question_bank_question_progress" ("student_id","class_id","id");
CREATE TABLE IF NOT EXISTS "users" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "username" text NOT NULL,
  "password_hash" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'student' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "priority_access" integer DEFAULT 0 NOT NULL,
  "phone" text,
  "subject" text,
  "additional_exams" text DEFAULT '[]' NOT NULL,
  "review_bucket_dismissed_question_ids" text DEFAULT '[]' NOT NULL,
  "avatar_url" text,
  "onboarding_complete" integer DEFAULT 0 NOT NULL,
  "student_profile_data" text,
  "must_change_password" integer DEFAULT 0 NOT NULL,
  "last_password_reset_email_at" integer,
  "reviewed_by_id" integer,
  "reviewed_at" integer,
  "approved_by_id" integer,
  "approved_at" integer,
  "rejection_reason" text,
  "pending_review_started_at" integer,
  "pending_review_escalated_at" integer,
  "email_opt_out" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_lower_email_idx" ON "users" (lower("email"));
CREATE INDEX IF NOT EXISTS "users_lower_username_idx" ON "users" (lower("username"));
CREATE INDEX IF NOT EXISTS "users_created_at_id_idx" ON "users" ("created_at","id");
CREATE INDEX IF NOT EXISTS "users_full_name_id_idx" ON "users" ("full_name","id");
CREATE INDEX IF NOT EXISTS "users_role_full_name_id_idx" ON "users" ("role","full_name","id");
CREATE INDEX IF NOT EXISTS "users_role_created_at_id_idx" ON "users" ("role","created_at","id");
CREATE INDEX IF NOT EXISTS "users_role_status_created_at_id_idx" ON "users" ("role","status","created_at","id");
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "classes" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "subject" text,
  "workflow_type" text DEFAULT 'question_bank' NOT NULL,
  "admin_id" integer,
  "planner_id" integer,
  "assigned_teacher_ids" text DEFAULT '[]' NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "is_locked" integer DEFAULT 0,
  "weekly_target_questions" integer,
  "weekly_target_deadline" text,
  "scheduled_at" integer,
  "max_students" integer,
  "meeting_link" text,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE set null,
  FOREIGN KEY ("planner_id") REFERENCES "users"("id") ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "classes_workflow_type_title_id_idx" ON "classes" ("workflow_type","title","id");
CREATE TABLE IF NOT EXISTS "enrollments" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "student_id" integer NOT NULL,
  "class_id" integer NOT NULL,
  "enrolled_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade,
  FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS "subjects" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "class_id" integer,
  "teacher_id" integer,
  "title" text NOT NULL,
  "description" text,
  "is_locked" integer DEFAULT 0 NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "subjects_class_id_order_created_at_id_idx" ON "subjects" ("class_id","order","created_at","id");
CREATE TABLE IF NOT EXISTS "chapters" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "subject_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "target_questions" integer DEFAULT 0 NOT NULL,
  "is_locked" integer DEFAULT 0 NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "chapters_subject_id_order_created_at_id_idx" ON "chapters" ("subject_id","order","created_at","id");
CREATE TABLE IF NOT EXISTS "test_question_bank_links" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "test_id" integer NOT NULL,
  "test_question_id" integer NOT NULL,
  "question_bank_question_id" integer NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE cascade,
  FOREIGN KEY ("test_question_id") REFERENCES "test_questions"("id") ON DELETE cascade,
  FOREIGN KEY ("question_bank_question_id") REFERENCES "question_bank_questions"("id") ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "test_question_bank_links_test_question_unique" ON "test_question_bank_links" ("test_question_id");
CREATE TABLE IF NOT EXISTS "test_question_reports" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "test_id" integer NOT NULL,
  "question_id" integer NOT NULL,
  "reported_by" integer NOT NULL,
  "teacher_id" integer NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "teacher_note" text,
  "created_at" integer DEFAULT (unixepoch() * 1000),
  "updated_at" integer DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE cascade,
  FOREIGN KEY ("question_id") REFERENCES "test_questions"("id") ON DELETE cascade,
  FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE cascade,
  FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "test_question_reports_test_id_reported_by_created_at_id_idx" ON "test_question_reports" ("test_id","reported_by","created_at","id");
CREATE INDEX IF NOT EXISTS "test_question_reports_reported_by_question_id_created_at_id_idx" ON "test_question_reports" ("reported_by","question_id","created_at","id");
CREATE TABLE IF NOT EXISTS "test_questions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "test_id" integer NOT NULL,
  "section_id" integer,
  "question" text NOT NULL,
  "question_type" text DEFAULT 'mcq' NOT NULL,
  "question_code" text,
  "source_type" text DEFAULT 'manual' NOT NULL,
  "subject_label" text,
  "options" text DEFAULT '[]' NOT NULL,
  "option_images" text,
  "correct_answer" real DEFAULT 0 NOT NULL,
  "correct_answer_multi" text,
  "correct_answer_min" real,
  "correct_answer_max" real,
  "points" integer DEFAULT 1 NOT NULL,
  "negative_marks" real DEFAULT 0 NOT NULL,
  "meta" text,
  "solution_text" text,
  "solution_image_data" text,
  "ai_solution_text" text,
  "order" integer DEFAULT 0 NOT NULL,
  "image_data" text,
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE cascade,
  FOREIGN KEY ("section_id") REFERENCES "test_sections"("id") ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "test_questions_test_id_order_id_idx" ON "test_questions" ("test_id","order","id");
CREATE TABLE IF NOT EXISTS "test_sections" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "test_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "subject_label" text,
  "question_count" integer,
  "marks_per_question" real,
  "negative_marks" real,
  "meta" text,
  "order" integer DEFAULT 0 NOT NULL,
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "test_sections_test_id_order_id_idx" ON "test_sections" ("test_id","order","id");
CREATE TABLE IF NOT EXISTS "test_submissions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "test_id" integer NOT NULL,
  "student_id" integer NOT NULL,
  "answers" text NOT NULL,
  "question_timings" text,
  "flagged_questions" text,
  "visited_question_ids" text,
  "review_question_ids" text,
  "interaction_log" text,
  "score" real DEFAULT 0 NOT NULL,
  "total_points" integer DEFAULT 0 NOT NULL,
  "percentage" real DEFAULT 0 NOT NULL,
  "passed" integer DEFAULT 0 NOT NULL,
  "submitted_at" integer DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE cascade,
  FOREIGN KEY ("student_id") REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "test_submissions_student_id_submitted_at_id_idx" ON "test_submissions" ("student_id","submitted_at","id");
CREATE INDEX IF NOT EXISTS "test_submissions_test_id_submitted_at_id_idx" ON "test_submissions" ("test_id","submitted_at","id");
CREATE INDEX IF NOT EXISTS "test_submissions_test_id_student_id_submitted_at_id_idx" ON "test_submissions" ("test_id","student_id","submitted_at","id");
CREATE TABLE IF NOT EXISTS "tests" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "class_id" integer,
  "chapter_id" integer,
  "title" text NOT NULL,
  "description" text,
  "exam_type" text DEFAULT 'custom' NOT NULL,
  "exam_header" text,
  "exam_subheader" text,
  "instructions" text,
  "exam_config" text,
  "duration_minutes" integer DEFAULT 30 NOT NULL,
  "passing_score" integer,
  "default_positive_marks" real DEFAULT 1 NOT NULL,
  "default_negative_marks" real DEFAULT 0 NOT NULL,
  "is_published" integer DEFAULT 0 NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "scheduled_at" integer,
  "created_by" integer,
  "created_at" integer DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE set null,
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "tests_created_by_idx" ON "tests" ("created_by");
CREATE INDEX IF NOT EXISTS "tests_display_order_idx" ON "tests" ("display_order");
CREATE INDEX IF NOT EXISTS "tests_is_published_idx" ON "tests" ("is_published");
CREATE INDEX IF NOT EXISTS "tests_published_display_order_created_at_id_idx" ON "tests" ("is_published",COALESCE("display_order", 0),"created_at" DESC,"id");
CREATE TABLE IF NOT EXISTS "user_activity_logs" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" integer NOT NULL,
  "action" text NOT NULL,
  "page" text,
  "detail" text,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE INDEX IF NOT EXISTS "user_activity_logs_user_id_created_at_id_idx" ON "user_activity_logs" ("user_id","created_at","id");
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" integer NOT NULL,
  "session_token" text NOT NULL,
  "ip_address" text,
  "location_label" text,
  "browser_name" text,
  "device_type" text,
  "user_agent" text,
  "started_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "last_active_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "ended_at" integer,
  "total_seconds" integer DEFAULT 0 NOT NULL,
  "is_active" integer DEFAULT 1 NOT NULL
);
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_last_active_at_id_idx" ON "user_sessions" ("user_id","last_active_at","id");
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_started_at_id_idx" ON "user_sessions" ("user_id","started_at","id");
CREATE INDEX IF NOT EXISTS "user_sessions_is_active_idx" ON "user_sessions" ("is_active");
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" integer NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text,
  "link" text,
  "is_read" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_id_idx" ON "notifications" ("user_id","created_at","id");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_id_idx" ON "notifications" ("user_id","is_read","id");
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" integer NOT NULL,
  "assignment" integer DEFAULT 1 NOT NULL,
  "grade" integer DEFAULT 1 NOT NULL,
  "test" integer DEFAULT 1 NOT NULL,
  "class" integer DEFAULT 1 NOT NULL,
  "system" integer DEFAULT 1 NOT NULL,
  "community" integer DEFAULT 1 NOT NULL,
  "digest" integer DEFAULT 1 NOT NULL,
  "weekly_digest" integer DEFAULT 1 NOT NULL,
  "last_digest_at" integer,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_unique" ON "notification_preferences" ("user_id");
CREATE TABLE IF NOT EXISTS "direct_messages" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "sender_id" integer NOT NULL,
  "receiver_id" integer NOT NULL,
  "content" text NOT NULL,
  "is_reported" integer DEFAULT 0 NOT NULL,
  "report_reason" text,
  "reported_at" integer,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("sender_id") REFERENCES "users"("id"),
  FOREIGN KEY ("receiver_id") REFERENCES "users"("id")
);
CREATE TABLE IF NOT EXISTS "question_bank_questions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "class_id" integer NOT NULL,
  "subject_id" integer NOT NULL,
  "chapter_id" integer NOT NULL,
  "question" text NOT NULL,
  "question_type" text DEFAULT 'mcq' NOT NULL,
  "options" text DEFAULT '[]' NOT NULL,
  "option_images" text,
  "correct_answer" real,
  "correct_answer_multi" text,
  "correct_answer_min" real,
  "correct_answer_max" real,
  "answer" text,
  "explanation" text,
  "topic_tag" text,
  "difficulty" text DEFAULT 'medium' NOT NULL,
  "points" integer DEFAULT 1 NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  "image_data" text,
  "source_test_id" integer,
  "source_test_question_id" integer,
  "created_by" integer,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE cascade,
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade,
  FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE cascade,
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null
);
CREATE INDEX IF NOT EXISTS "question_bank_questions_class_id_order_created_at_id_idx" ON "question_bank_questions" ("class_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_questions_chapter_id_order_created_at_id_idx" ON "question_bank_questions" ("chapter_id","order","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_questions_created_by_created_at_id_idx" ON "question_bank_questions" ("created_by","created_at","id");
CREATE TABLE IF NOT EXISTS "question_bank_reports" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "question_id" integer NOT NULL,
  "class_id" integer NOT NULL,
  "subject_id" integer NOT NULL,
  "chapter_id" integer NOT NULL,
  "reported_by" integer NOT NULL,
  "teacher_id" integer NOT NULL,
  "reason" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("question_id") REFERENCES "question_bank_questions"("id") ON DELETE cascade,
  FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE cascade,
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE cascade,
  FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE cascade,
  FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE cascade,
  FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "question_bank_reports_question_id_created_at_id_idx" ON "question_bank_reports" ("question_id","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_teacher_id_created_at_id_idx" ON "question_bank_reports" ("teacher_id","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_teacher_id_status_created_at_id_idx" ON "question_bank_reports" ("teacher_id","status","created_at","id");
CREATE INDEX IF NOT EXISTS "question_bank_reports_created_at_id_idx" ON "question_bank_reports" ("created_at" DESC,"id" DESC);
CREATE TABLE IF NOT EXISTS "question_bank_saved_questions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "question_id" integer NOT NULL,
  "student_id" integer NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("question_id") REFERENCES "question_bank_questions"("id") ON DELETE cascade,
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "question_bank_saved_questions_student_id_question_id_idx" ON "question_bank_saved_questions" ("student_id","question_id");
CREATE INDEX IF NOT EXISTS "question_bank_saved_questions_student_id_created_at_id_idx" ON "question_bank_saved_questions" ("student_id","created_at","id");
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "student_review_email_enabled" integer DEFAULT 1 NOT NULL,
  "student_review_email_actions_enabled" integer DEFAULT 1 NOT NULL,
  "ai_access_for_all_students" integer DEFAULT 0 NOT NULL,
  "registration_closed_until" integer,
  "total_visitors" integer DEFAULT 0 NOT NULL,
  "today_visitors" integer DEFAULT 0 NOT NULL,
  "today_date" text,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS "password_reset_requests" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" integer NOT NULL,
  "requested_username" text NOT NULL,
  "requested_email" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_by" integer,
  "resolution_note" text,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id")
);
CREATE TABLE IF NOT EXISTS "registration_email_otps" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "challenge_id" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "username" text NOT NULL,
  "full_name" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" integer NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "verified_at" integer,
  "consumed_at" integer,
  "last_sent_at" integer NOT NULL,
  "created_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "registration_email_otps_email_created_at_idx" ON "registration_email_otps" ("email", "created_at");
CREATE TABLE IF NOT EXISTS "exam_templates" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "exam_header" text,
  "exam_subheader" text,
  "instructions" text,
  "duration_minutes" integer DEFAULT 180 NOT NULL,
  "passing_score" integer,
  "default_positive_marks" real DEFAULT 1 NOT NULL,
  "default_negative_marks" real DEFAULT 0 NOT NULL,
  "sections" text NOT NULL,
  "is_system" integer DEFAULT 0 NOT NULL,
  "is_locked" integer DEFAULT 0 NOT NULL,
  "show_in_registration" integer DEFAULT 1 NOT NULL,
  "created_by" integer,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
);
CREATE TABLE IF NOT EXISTS "email_provider_daily_usage" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "provider_key" text NOT NULL,
  "usage_date" text NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "last_sent_at" integer,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_provider_daily_usage_provider_date_unique" ON "email_provider_daily_usage" ("provider_key","usage_date");
CREATE TABLE IF NOT EXISTS "email_provider_configs" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "provider_key" text NOT NULL,
  "provider_name" text NOT NULL,
  "provider_type" text DEFAULT 'brevo' NOT NULL,
  "api_key" text NOT NULL,
  "sender_email" text NOT NULL,
  "sender_name" text DEFAULT 'Rank Pulse' NOT NULL,
  "reply_to_email" text,
  "reply_to_name" text,
  "daily_limit" integer DEFAULT 300 NOT NULL,
  "daily_soft_limit" integer DEFAULT 250 NOT NULL,
  "is_active" integer DEFAULT 1 NOT NULL,
  "created_by_id" integer,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_provider_configs_provider_key_unique" ON "email_provider_configs" ("provider_key");
CREATE TABLE IF NOT EXISTS "email_send_logs" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "provider_key" text NOT NULL,
  "provider_name" text NOT NULL,
  "provider_source" text DEFAULT 'database' NOT NULL,
  "sender_email" text NOT NULL,
  "recipient_email" text NOT NULL,
  "subject" text NOT NULL,
  "message_type" text DEFAULT 'transactional' NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "error_message" text,
  "metadata" text,
  "sent_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_send_logs_recipient_email_sent_at_id_idx" ON "email_send_logs" ("recipient_email","sent_at","id");
CREATE INDEX IF NOT EXISTS "email_send_logs_sent_at_id_idx" ON "email_send_logs" ("sent_at","id");
CREATE TABLE IF NOT EXISTS "payment_history" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "student_id" integer NOT NULL,
  "feature" text DEFAULT 'tests' NOT NULL,
  "amount" real NOT NULL,
  "order_id" text DEFAULT '' NOT NULL,
  "payment_id" text DEFAULT '' NOT NULL,
  "paid_at" integer NOT NULL,
  "cycle" integer DEFAULT 1 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS "ai_api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "provider" text DEFAULT 'openrouter' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "limit_exhausted" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS "meta_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "test_title" text,
  "file_names" text NOT NULL,
  "question_count" integer NOT NULL,
  "rows" text NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS "ai_similar_questions" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "student_id" integer NOT NULL,
  "source" text NOT NULL,
  "source_question_id" integer,
  "exam" text,
  "subject" text,
  "chapter" text,
  "difficulty" text NOT NULL,
  "question_type" text DEFAULT 'mcq' NOT NULL,
  "question" text NOT NULL,
  "options" text DEFAULT '[]' NOT NULL,
  "correct_answer" integer,
  "correct_answer_multi" text,
  "answer_text" text,
  "explanation" text,
  "diagram" text,
  "last_answer" text,
  "solved_at" integer,
  "is_saved" integer DEFAULT 0 NOT NULL,
  "created_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "ai_similar_questions_student_source_chapter_idx" ON "ai_similar_questions" ("student_id","source","chapter","created_at" DESC,"id" DESC);
CREATE TABLE IF NOT EXISTS "ai_account_cooldowns" (
  "account_key" text PRIMARY KEY NOT NULL,
  "blocked_until" integer NOT NULL,
  "reason" text NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "ai_response_cache" (
  "cache_key" text PRIMARY KEY NOT NULL,
  "response_json" text NOT NULL,
  "expires_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ai_response_cache_expires_at" ON "ai_response_cache" ("expires_at");
`;
