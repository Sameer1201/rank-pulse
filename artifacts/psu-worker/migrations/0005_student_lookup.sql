CREATE INDEX IF NOT EXISTS qb_progress_student_question_idx
  ON question_bank_question_progress(student_id, question_id);
CREATE INDEX IF NOT EXISTS psu_attempts_student_date_idx
  ON psu_test_attempts(student_id, submitted_at DESC, id DESC);
