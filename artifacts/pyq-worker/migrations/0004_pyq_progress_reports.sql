CREATE TABLE IF NOT EXISTS pyq_question_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  last_answer TEXT,
  last_is_correct INTEGER NOT NULL DEFAULT 0,
  first_attempted_at INTEGER NOT NULL,
  last_attempted_at INTEGER NOT NULL,
  solved_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS pyq_question_progress_question_student_idx
  ON pyq_question_progress (question_id, student_id);
CREATE INDEX IF NOT EXISTS pyq_question_progress_student_last_attempted_idx
  ON pyq_question_progress (student_id, last_attempted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS pyq_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  reported_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pyq_reports_status_created_idx
  ON pyq_reports (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS pyq_reports_question_created_idx
  ON pyq_reports (question_id, created_at DESC, id DESC);
