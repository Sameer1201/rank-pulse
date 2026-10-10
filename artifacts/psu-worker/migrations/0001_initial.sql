CREATE TABLE IF NOT EXISTS psus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psus_published_name_idx ON psus(is_published, name, id);

CREATE TABLE IF NOT EXISTS psu_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psu_id INTEGER NOT NULL REFERENCES psus(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  question_count INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  bundle_json TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psu_tests_psu_published_idx ON psu_tests(psu_id, is_published, created_at, id);

CREATE TABLE IF NOT EXISTS psu_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psu_id INTEGER NOT NULL REFERENCES psus(id) ON DELETE CASCADE,
  exam TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT 'General',
  chapter_order INTEGER NOT NULL DEFAULT 0,
  question_number INTEGER,
  marks TEXT,
  year INTEGER NOT NULL,
  paper TEXT,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'mcq',
  options_json TEXT NOT NULL DEFAULT '[]',
  correct_answer INTEGER,
  correct_answer_multi TEXT NOT NULL DEFAULT '[]',
  answer_text TEXT,
  answer_min REAL,
  answer_max REAL,
  explanation TEXT,
  source_name TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS psu_questions_catalog_idx ON psu_questions(psu_id, exam, subject, chapter_order, chapter, year DESC, id DESC);
