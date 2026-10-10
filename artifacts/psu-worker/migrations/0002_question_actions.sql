CREATE TABLE IF NOT EXISTS psu_saved_questions (
  student_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES psu_questions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, question_id)
);
CREATE INDEX IF NOT EXISTS psu_saved_questions_student_idx ON psu_saved_questions(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS psu_question_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psu_id INTEGER NOT NULL REFERENCES psus(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES psu_questions(id) ON DELETE CASCADE,
  reported_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psu_question_reports_psu_status_idx ON psu_question_reports(psu_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS psu_question_reports_question_idx ON psu_question_reports(question_id, created_at DESC, id DESC);
