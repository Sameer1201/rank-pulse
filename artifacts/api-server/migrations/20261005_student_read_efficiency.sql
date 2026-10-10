-- Small, student-keyed cache: one row per student, not a cache entry per request.
CREATE TABLE IF NOT EXISTS student_daily_activity_cache (
  student_id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jam_pyq_submissions_student_day_idx
  ON jam_pyq_submissions(student_id, submitted_at, question_id);
