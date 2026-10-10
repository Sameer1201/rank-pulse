CREATE TABLE IF NOT EXISTS pyq_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL,
  subject TEXT NOT NULL,
  year INTEGER NOT NULL,
  paper TEXT,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'mcq',
  options_json TEXT NOT NULL DEFAULT '[]',
  correct_answer INTEGER,
  explanation TEXT,
  image_data TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pyq_questions_exam_subject_year_idx
  ON pyq_questions (exam, subject, year DESC, id DESC);

CREATE INDEX IF NOT EXISTS pyq_questions_created_at_idx
  ON pyq_questions (created_at DESC, id DESC);
