-- Small, transactionally maintained catalog totals. Dashboard reads scale with
-- chapters instead of questions; progress remains live and student-scoped.
CREATE TABLE IF NOT EXISTS jam_pyq_catalog_counts (
  exam TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  chapter_order INTEGER NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count >= 0),
  PRIMARY KEY (exam, subject, chapter, chapter_order)
) WITHOUT ROWID;

INSERT INTO jam_pyq_catalog_counts (exam, subject, chapter, chapter_order, question_count)
SELECT exam, subject, chapter, chapter_order, COUNT(*) FROM pyq_questions
GROUP BY exam, subject, chapter, chapter_order
ON CONFLICT (exam, subject, chapter, chapter_order) DO UPDATE SET question_count = excluded.question_count;

CREATE TRIGGER IF NOT EXISTS jam_pyq_catalog_insert AFTER INSERT ON pyq_questions BEGIN
  INSERT INTO jam_pyq_catalog_counts VALUES (NEW.exam, NEW.subject, NEW.chapter, NEW.chapter_order, 1)
  ON CONFLICT (exam, subject, chapter, chapter_order) DO UPDATE SET question_count = question_count + 1;
END;
CREATE TRIGGER IF NOT EXISTS jam_pyq_catalog_delete AFTER DELETE ON pyq_questions BEGIN
  UPDATE jam_pyq_catalog_counts SET question_count = question_count - 1
  WHERE exam = OLD.exam AND subject = OLD.subject AND chapter = OLD.chapter AND chapter_order = OLD.chapter_order;
  DELETE FROM jam_pyq_catalog_counts WHERE exam = OLD.exam AND subject = OLD.subject AND chapter = OLD.chapter AND chapter_order = OLD.chapter_order AND question_count = 0;
END;
CREATE TRIGGER IF NOT EXISTS jam_pyq_catalog_move AFTER UPDATE OF exam, subject, chapter, chapter_order ON pyq_questions
WHEN OLD.exam != NEW.exam OR OLD.subject != NEW.subject OR OLD.chapter != NEW.chapter OR OLD.chapter_order != NEW.chapter_order BEGIN
  UPDATE jam_pyq_catalog_counts SET question_count = question_count - 1
  WHERE exam = OLD.exam AND subject = OLD.subject AND chapter = OLD.chapter AND chapter_order = OLD.chapter_order;
  DELETE FROM jam_pyq_catalog_counts WHERE exam = OLD.exam AND subject = OLD.subject AND chapter = OLD.chapter AND chapter_order = OLD.chapter_order AND question_count = 0;
  INSERT INTO jam_pyq_catalog_counts VALUES (NEW.exam, NEW.subject, NEW.chapter, NEW.chapter_order, 1)
  ON CONFLICT (exam, subject, chapter, chapter_order) DO UPDATE SET question_count = question_count + 1;
END;

CREATE TABLE IF NOT EXISTS jam_qb_catalog_counts (
  class_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count >= 0),
  PRIMARY KEY (class_id, chapter_id)
) WITHOUT ROWID;
INSERT INTO jam_qb_catalog_counts (class_id, chapter_id, question_count)
SELECT class_id, chapter_id, COUNT(*) FROM question_bank_questions GROUP BY class_id, chapter_id
ON CONFLICT (class_id, chapter_id) DO UPDATE SET question_count = excluded.question_count;

CREATE TRIGGER IF NOT EXISTS jam_qb_catalog_insert AFTER INSERT ON question_bank_questions BEGIN
  INSERT INTO jam_qb_catalog_counts VALUES (NEW.class_id, NEW.chapter_id, 1)
  ON CONFLICT (class_id, chapter_id) DO UPDATE SET question_count = question_count + 1;
END;
CREATE TRIGGER IF NOT EXISTS jam_qb_catalog_delete AFTER DELETE ON question_bank_questions BEGIN
  UPDATE jam_qb_catalog_counts SET question_count = question_count - 1 WHERE class_id = OLD.class_id AND chapter_id = OLD.chapter_id;
  DELETE FROM jam_qb_catalog_counts WHERE class_id = OLD.class_id AND chapter_id = OLD.chapter_id AND question_count = 0;
END;
CREATE TRIGGER IF NOT EXISTS jam_qb_catalog_move AFTER UPDATE OF class_id, chapter_id ON question_bank_questions
WHEN OLD.class_id != NEW.class_id OR OLD.chapter_id != NEW.chapter_id BEGIN
  UPDATE jam_qb_catalog_counts SET question_count = question_count - 1 WHERE class_id = OLD.class_id AND chapter_id = OLD.chapter_id;
  DELETE FROM jam_qb_catalog_counts WHERE class_id = OLD.class_id AND chapter_id = OLD.chapter_id AND question_count = 0;
  INSERT INTO jam_qb_catalog_counts VALUES (NEW.class_id, NEW.chapter_id, 1)
  ON CONFLICT (class_id, chapter_id) DO UPDATE SET question_count = question_count + 1;
END;

-- Match chapter filtering and the actual practice-page ordering.
CREATE INDEX IF NOT EXISTS jam_pyq_chapter_practice_idx ON pyq_questions (exam, subject, chapter, chapter_order, question_number, year DESC, id DESC);
CREATE INDEX IF NOT EXISTS jam_pyq_subject_practice_idx ON pyq_questions (exam, subject, chapter_order, question_number, year DESC, id DESC);
CREATE INDEX IF NOT EXISTS jam_pyq_progress_student_question_idx ON pyq_question_progress (student_id, question_id);
CREATE INDEX IF NOT EXISTS jam_qb_class_chapter_idx ON question_bank_questions (class_id, chapter_id);
