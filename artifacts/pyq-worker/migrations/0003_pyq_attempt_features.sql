ALTER TABLE pyq_questions ADD COLUMN correct_answer_multi TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pyq_questions ADD COLUMN answer_min REAL;
ALTER TABLE pyq_questions ADD COLUMN answer_max REAL;

CREATE TABLE IF NOT EXISTS pyq_saved_questions (
  student_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, question_id)
);

CREATE INDEX IF NOT EXISTS pyq_saved_questions_student_idx
  ON pyq_saved_questions (student_id, created_at DESC);
