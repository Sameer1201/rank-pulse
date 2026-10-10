-- Apply only to content databases containing the corresponding progress table.
-- The migration runner checks table_info before adding each column (rerunnable).
ALTER TABLE question_bank_question_progress ADD COLUMN offline_submission_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pyq_question_progress ADD COLUMN offline_submission_ids TEXT NOT NULL DEFAULT '[]';
