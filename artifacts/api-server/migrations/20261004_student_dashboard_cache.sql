CREATE TABLE IF NOT EXISTS student_dashboard_cache (
  student_id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
