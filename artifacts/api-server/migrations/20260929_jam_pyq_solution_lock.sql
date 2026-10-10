CREATE TABLE IF NOT EXISTS jam_pyq_solution_access (
  student_id INTEGER PRIMARY KEY,
  enabled_by INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jam_pyq_submissions (
  student_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_jam_pyq_submissions_question
  ON jam_pyq_submissions(question_id);
