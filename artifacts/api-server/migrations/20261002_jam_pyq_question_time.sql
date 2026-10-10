CREATE TABLE IF NOT EXISTS jam_pyq_question_time (
  student_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_jam_pyq_question_time_question
  ON jam_pyq_question_time(question_id);
