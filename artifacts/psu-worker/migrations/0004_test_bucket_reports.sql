CREATE TABLE IF NOT EXISTS psu_test_review_dismissals (
  student_id INTEGER NOT NULL,
  test_id INTEGER NOT NULL REFERENCES psu_tests(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(student_id, test_id, question_order)
);

CREATE TABLE IF NOT EXISTS psu_test_question_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psu_id INTEGER NOT NULL REFERENCES psus(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES psu_tests(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL,
  reported_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(test_id, question_order, reported_by)
);

CREATE INDEX IF NOT EXISTS psu_test_question_reports_status_idx
  ON psu_test_question_reports(psu_id, status, created_at DESC);
