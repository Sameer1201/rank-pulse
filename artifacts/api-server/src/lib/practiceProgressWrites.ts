// One indexed write replaces SELECT + UPDATE and preserves concurrent attempts.
export const QB_ATTEMPT_UPSERT = `INSERT INTO question_bank_question_progress
  (student_id, question_id, class_id, subject_id, chapter_id, attempt_count, correct_count, incorrect_count,
   last_answer, first_attempted_at, last_attempted_at, solved_at, last_is_correct)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(question_id, student_id) DO UPDATE SET
    attempt_count = question_bank_question_progress.attempt_count + 1,
    correct_count = question_bank_question_progress.correct_count + excluded.correct_count,
    incorrect_count = question_bank_question_progress.incorrect_count + excluded.incorrect_count,
    last_answer = excluded.last_answer, last_attempted_at = excluded.last_attempted_at,
    solved_at = COALESCE(excluded.solved_at, question_bank_question_progress.solved_at),
    last_is_correct = excluded.last_is_correct,
    class_id = excluded.class_id, subject_id = excluded.subject_id, chapter_id = excluded.chapter_id
  RETURNING attempt_count, correct_count, incorrect_count, first_attempted_at, last_attempted_at, solved_at, last_is_correct`;

export const PYQ_ATTEMPT_UPSERT = `INSERT INTO pyq_question_progress
  (question_id, student_id, attempt_count, correct_count, incorrect_count, last_answer,
   last_is_correct, first_attempted_at, last_attempted_at, solved_at)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(question_id, student_id) DO UPDATE SET
    attempt_count = pyq_question_progress.attempt_count + 1,
    correct_count = pyq_question_progress.correct_count + excluded.correct_count,
    incorrect_count = pyq_question_progress.incorrect_count + excluded.incorrect_count,
    last_answer = excluded.last_answer, last_is_correct = excluded.last_is_correct,
    last_attempted_at = excluded.last_attempted_at,
    solved_at = COALESCE(excluded.solved_at, pyq_question_progress.solved_at)
  RETURNING attempt_count, correct_count, incorrect_count, first_attempted_at, last_attempted_at, solved_at, last_is_correct`;
