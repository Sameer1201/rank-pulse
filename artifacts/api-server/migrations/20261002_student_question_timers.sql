CREATE TABLE IF NOT EXISTS student_question_timers (
  student_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pyq', 'question-bank')),
  exam_key TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, source_type, exam_key, question_id)
);

CREATE INDEX IF NOT EXISTS idx_student_question_timers_lookup
  ON student_question_timers (source_type, exam_key, question_id, student_id);

INSERT INTO student_question_timers (student_id, source_type, exam_key, question_id, time_spent_seconds, updated_at)
SELECT student_id, 'pyq', 'jam-chemistry', question_id, time_spent_seconds, updated_at
FROM jam_pyq_question_time WHERE 1
ON CONFLICT(student_id, source_type, exam_key, question_id) DO UPDATE SET
  time_spent_seconds = MAX(student_question_timers.time_spent_seconds, excluded.time_spent_seconds),
  updated_at = MAX(student_question_timers.updated_at, excluded.updated_at);
