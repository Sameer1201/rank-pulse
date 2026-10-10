ALTER TABLE pyq_questions ADD COLUMN chapter TEXT NOT NULL DEFAULT '';
ALTER TABLE pyq_questions ADD COLUMN chapter_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pyq_questions ADD COLUMN question_number INTEGER;
ALTER TABLE pyq_questions ADD COLUMN marks TEXT;
ALTER TABLE pyq_questions ADD COLUMN answer_text TEXT;
ALTER TABLE pyq_questions ADD COLUMN source_url TEXT;
ALTER TABLE pyq_questions ADD COLUMN source_name TEXT;

CREATE INDEX IF NOT EXISTS pyq_questions_subject_chapter_idx
  ON pyq_questions (exam, subject, chapter_order, chapter, year DESC, id DESC);
