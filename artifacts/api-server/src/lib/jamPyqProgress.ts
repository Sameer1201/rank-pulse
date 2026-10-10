// A one-time answer lives in the account DB; progress lives with JAM content.
// Project only missing rows so retries, refreshes and concurrent devices cannot
// increment the count or overwrite established practice history.
export const JAM_SUBMISSION_PROGRESS_SQL = `
  INSERT OR IGNORE INTO pyq_question_progress
    (question_id, student_id, attempt_count, correct_count, incorrect_count,
     last_answer, last_is_correct, first_attempted_at, last_attempted_at, solved_at)
  SELECT q.id, ?, 1, json_extract(s.value, '$.is_correct'),
    1 - json_extract(s.value, '$.is_correct'), json_extract(s.value, '$.answer_json'),
    json_extract(s.value, '$.is_correct'), json_extract(s.value, '$.submitted_at'),
    json_extract(s.value, '$.submitted_at'),
    CASE WHEN json_extract(s.value, '$.is_correct') = 1 THEN json_extract(s.value, '$.submitted_at') ELSE NULL END
  FROM json_each(?) s JOIN pyq_questions q ON q.id = json_extract(s.value, '$.question_id')
  WHERE q.exam = ?
    AND NOT EXISTS (SELECT 1 FROM pyq_question_progress p WHERE p.question_id = q.id AND p.student_id = ?)
`;

export const JAM_SINGLE_SUBMISSION_PROGRESS_SQL = `
  INSERT OR IGNORE INTO pyq_question_progress
    (question_id, student_id, attempt_count, correct_count, incorrect_count,
     last_answer, last_is_correct, first_attempted_at, last_attempted_at, solved_at)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
`;
