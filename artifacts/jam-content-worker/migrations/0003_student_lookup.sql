CREATE INDEX IF NOT EXISTS qb_progress_student_question_idx
  ON question_bank_question_progress(student_id, question_id);
