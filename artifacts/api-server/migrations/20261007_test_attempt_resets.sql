-- Private recovery archive. Resetting an attempt never deletes test content.
CREATE TABLE IF NOT EXISTS test_attempt_reset_audit (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('regular','psu')),
  test_id INTEGER NOT NULL,
  psu_id INTEGER,
  student_id INTEGER NOT NULL,
  reset_by INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared','completed')),
  original_submissions_json TEXT NOT NULL,
  activity_snapshot_json TEXT NOT NULL,
  question_ids_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS test_attempt_reset_student_idx
  ON test_attempt_reset_audit(student_id,reset_at,id);
CREATE INDEX IF NOT EXISTS test_attempt_reset_target_idx
  ON test_attempt_reset_audit(source,test_id,student_id,reset_at);

-- Existing insert/update triggers maintain totals; resets also need subtraction.
CREATE TRIGGER IF NOT EXISTS student_activity_delete AFTER DELETE ON student_daily_question_activity
BEGIN
  UPDATE student_daily_activity_totals SET
    correct = MAX(0,correct - (OLD.outcome = 1)),
    wrong = MAX(0,wrong - (OLD.outcome = 0)),
    unanswered = MAX(0,unanswered - (OLD.outcome = -1)),
    ungraded = MAX(0,ungraded - (OLD.outcome = 2)),
    seconds = MAX(0,seconds - OLD.seconds)
  WHERE student_id=OLD.student_id AND day=OLD.day;
  DELETE FROM student_daily_activity_totals WHERE student_id=OLD.student_id AND day=OLD.day
    AND correct=0 AND wrong=0 AND unanswered=0 AND ungraded=0 AND seconds=0;
END;
