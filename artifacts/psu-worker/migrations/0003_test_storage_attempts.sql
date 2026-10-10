CREATE TABLE IF NOT EXISTS psu_test_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES psu_tests(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL,
  question_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(test_id, question_order)
);
CREATE INDEX IF NOT EXISTS psu_test_questions_order_idx ON psu_test_questions(test_id, question_order);

CREATE TABLE IF NOT EXISTS psu_test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psu_id INTEGER NOT NULL REFERENCES psus(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES psu_tests(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  answers_json TEXT NOT NULL DEFAULT '{}',
  question_timings_json TEXT NOT NULL DEFAULT '{}',
  interaction_log_json TEXT NOT NULL DEFAULT '[]',
  flagged_questions_json TEXT NOT NULL DEFAULT '[]',
  score REAL NOT NULL DEFAULT 0,
  total_points REAL NOT NULL DEFAULT 0,
  percentage REAL NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_time_seconds REAL NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psu_test_attempts_student_idx ON psu_test_attempts(student_id, test_id, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS psu_test_attempts_test_idx ON psu_test_attempts(test_id, submitted_at DESC, id DESC);
