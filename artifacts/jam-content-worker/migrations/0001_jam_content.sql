-- JAM Chemistry Question Bank and PYQ content database.
-- Logical user/class/test IDs are owned by the main application database.

CREATE TABLE IF NOT EXISTS question_bank_questions (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'mcq',
  options TEXT NOT NULL DEFAULT '[]',
  option_images TEXT,
  correct_answer REAL,
  correct_answer_multi TEXT,
  correct_answer_min REAL,
  correct_answer_max REAL,
  answer TEXT,
  explanation TEXT,
  topic_tag TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  points INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  image_data TEXT,
  source_test_id INTEGER,
  source_test_question_id INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS jam_qb_questions_class_order_idx ON question_bank_questions (class_id, "order", created_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_questions_chapter_order_idx ON question_bank_questions (chapter_id, "order", created_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_questions_creator_idx ON question_bank_questions (created_by, created_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_questions_source_idx ON question_bank_questions (source_test_id, source_test_question_id);

CREATE TABLE IF NOT EXISTS question_bank_question_progress (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  last_answer TEXT,
  last_is_correct INTEGER NOT NULL DEFAULT 0,
  first_attempted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_attempted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  solved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS jam_qb_progress_unique ON question_bank_question_progress (question_id, student_id);
CREATE INDEX IF NOT EXISTS jam_qb_progress_student_idx ON question_bank_question_progress (student_id, last_attempted_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_progress_student_class_idx ON question_bank_question_progress (student_id, class_id, id);

CREATE TABLE IF NOT EXISTS question_bank_saved_questions (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS jam_qb_saved_unique ON question_bank_saved_questions (student_id, question_id);
CREATE INDEX IF NOT EXISTS jam_qb_saved_student_idx ON question_bank_saved_questions (student_id, created_at, id);

CREATE TABLE IF NOT EXISTS question_bank_reports (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  class_id INTEGER,
  subject_id INTEGER,
  chapter_id INTEGER,
  reported_by INTEGER NOT NULL,
  teacher_id INTEGER,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS jam_qb_reports_question_idx ON question_bank_reports (question_id, created_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_reports_teacher_idx ON question_bank_reports (teacher_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS jam_qb_reports_created_idx ON question_bank_reports (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS test_question_bank_links (
  id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL,
  test_question_id INTEGER NOT NULL,
  question_bank_question_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS jam_qb_links_test_question_unique ON test_question_bank_links (test_question_id);
CREATE INDEX IF NOT EXISTS jam_qb_links_test_idx ON test_question_bank_links (test_id, test_question_id, question_bank_question_id);
CREATE INDEX IF NOT EXISTS jam_qb_links_question_idx ON test_question_bank_links (question_bank_question_id);

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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  chapter TEXT NOT NULL DEFAULT '',
  chapter_order INTEGER NOT NULL DEFAULT 0,
  question_number INTEGER,
  marks TEXT,
  answer_text TEXT,
  source_url TEXT,
  source_name TEXT,
  correct_answer_multi TEXT NOT NULL DEFAULT '[]',
  answer_min REAL,
  answer_max REAL
);
CREATE INDEX IF NOT EXISTS jam_pyq_exam_subject_year_idx ON pyq_questions (exam, subject, year DESC, id DESC);
CREATE INDEX IF NOT EXISTS jam_pyq_subject_chapter_idx ON pyq_questions (exam, subject, chapter_order, chapter, year DESC, id DESC);
CREATE INDEX IF NOT EXISTS jam_pyq_created_idx ON pyq_questions (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS pyq_saved_questions (
  student_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, question_id)
);
CREATE INDEX IF NOT EXISTS jam_pyq_saved_student_idx ON pyq_saved_questions (student_id, created_at DESC);

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
CREATE UNIQUE INDEX IF NOT EXISTS jam_pyq_progress_unique ON pyq_question_progress (question_id, student_id);
CREATE INDEX IF NOT EXISTS jam_pyq_progress_student_idx ON pyq_question_progress (student_id, last_attempted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS pyq_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  reported_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jam_pyq_reports_status_idx ON pyq_reports (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS jam_pyq_reports_question_idx ON pyq_reports (question_id, created_at DESC, id DESC);
