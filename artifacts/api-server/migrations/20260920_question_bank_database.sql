-- Question-bank content database schema.
-- Apply this file to the separate qbank database, not to the main rank database.
-- Cross-database foreign keys are intentionally omitted. The Worker validates
-- class/subject/chapter/user IDs against the main DB and keeps all logical IDs.

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

CREATE INDEX IF NOT EXISTS question_bank_questions_class_id_order_created_at_id_idx
  ON question_bank_questions (class_id, "order", created_at, id);
CREATE INDEX IF NOT EXISTS question_bank_questions_chapter_id_order_created_at_id_idx
  ON question_bank_questions (chapter_id, "order", created_at, id);
CREATE INDEX IF NOT EXISTS question_bank_questions_created_by_created_at_id_idx
  ON question_bank_questions (created_by, created_at, id);
CREATE INDEX IF NOT EXISTS question_bank_questions_source_test_question_idx
  ON question_bank_questions (source_test_id, source_test_question_id);

-- Question Bank state is stored beside Question Bank content. IDs for users,
-- classes, subjects, chapters, tests, and test questions remain logical IDs
-- owned by the main database. Cross-database foreign keys are not possible.
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
  solved_at INTEGER,
  FOREIGN KEY (question_id) REFERENCES question_bank_questions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS question_bank_question_progress_unique
  ON question_bank_question_progress (question_id, student_id);
CREATE INDEX IF NOT EXISTS question_bank_question_progress_student_id_last_attempted_at_id_idx
  ON question_bank_question_progress (student_id, last_attempted_at, id);
CREATE INDEX IF NOT EXISTS question_bank_question_progress_student_id_class_id_id_idx
  ON question_bank_question_progress (student_id, class_id, id);

CREATE TABLE IF NOT EXISTS question_bank_saved_questions (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (question_id) REFERENCES question_bank_questions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS question_bank_saved_questions_student_id_question_id_unique
  ON question_bank_saved_questions (student_id, question_id);
CREATE INDEX IF NOT EXISTS question_bank_saved_questions_student_id_created_at_id_idx
  ON question_bank_saved_questions (student_id, created_at, id);

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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (question_id) REFERENCES question_bank_questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS question_bank_reports_question_id_created_at_id_idx
  ON question_bank_reports (question_id, created_at, id);
CREATE INDEX IF NOT EXISTS question_bank_reports_teacher_id_status_created_at_id_idx
  ON question_bank_reports (teacher_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS question_bank_reports_created_at_id_idx
  ON question_bank_reports (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS test_question_bank_links (
  id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL,
  test_question_id INTEGER NOT NULL,
  question_bank_question_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (question_bank_question_id) REFERENCES question_bank_questions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS test_question_bank_links_test_question_unique
  ON test_question_bank_links (test_question_id);
CREATE INDEX IF NOT EXISTS test_question_bank_links_test_id_question_idx
  ON test_question_bank_links (test_id, test_question_id, question_bank_question_id);
CREATE INDEX IF NOT EXISTS test_question_bank_links_question_bank_question_id_idx
  ON test_question_bank_links (question_bank_question_id);

ANALYZE;
