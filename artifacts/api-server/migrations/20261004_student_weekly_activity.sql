-- Append-only daily history: lifetime progress cannot reconstruct older days.
CREATE TABLE IF NOT EXISTS student_activity_tracking (
  id INTEGER PRIMARY KEY CHECK (id = 1), started_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO student_activity_tracking VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS student_daily_question_activity (
  student_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  question_key TEXT NOT NULL,
  outcome INTEGER NOT NULL DEFAULT -1 CHECK (outcome IN (-1, 0, 1, 2, 3)),
  seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  answered_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, day, question_key)
);
-- Seven indexed summary rows per weekly chart, independent of bank/chapter size.
CREATE TABLE IF NOT EXISTS student_daily_activity_totals (
  student_id INTEGER NOT NULL, day TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0,
  unanswered INTEGER NOT NULL DEFAULT 0, ungraded INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, day)
);
CREATE TRIGGER IF NOT EXISTS student_activity_insert AFTER INSERT ON student_daily_question_activity
BEGIN
  INSERT INTO student_daily_activity_totals VALUES
    (NEW.student_id, NEW.day, NEW.outcome = 1, NEW.outcome = 0, NEW.outcome = -1, NEW.outcome = 2, NEW.seconds)
  ON CONFLICT(student_id, day) DO UPDATE SET
    correct = correct + excluded.correct, wrong = wrong + excluded.wrong,
    unanswered = unanswered + excluded.unanswered, ungraded = ungraded + excluded.ungraded,
    seconds = seconds + excluded.seconds;
END;
CREATE TRIGGER IF NOT EXISTS student_activity_update AFTER UPDATE ON student_daily_question_activity
BEGIN
  UPDATE student_daily_activity_totals SET
    correct = correct + (NEW.outcome = 1) - (OLD.outcome = 1),
    wrong = wrong + (NEW.outcome = 0) - (OLD.outcome = 0),
    unanswered = unanswered + (NEW.outcome = -1) - (OLD.outcome = -1),
    ungraded = ungraded + (NEW.outcome = 2) - (OLD.outcome = 2),
    seconds = seconds + NEW.seconds - OLD.seconds
  WHERE student_id = NEW.student_id AND day = NEW.day;
END;

-- Only new timer deltas are credited, never a pre-existing lifetime total.
-- Timer writes are already monotonic; retried/stale saves add zero seconds.
CREATE TRIGGER IF NOT EXISTS student_activity_timer_insert AFTER INSERT ON student_question_timers
BEGIN
  INSERT INTO student_daily_question_activity (student_id, day, question_key, seconds, updated_at)
  VALUES (NEW.student_id, date(NEW.updated_at / 1000, 'unixepoch', '+330 minutes'),
    CASE WHEN NEW.source_type = 'pyq' THEN 'pyq:' || NEW.exam_key || ':' ELSE 'question-bank:' END || NEW.question_id,
    NEW.time_spent_seconds, NEW.updated_at)
  ON CONFLICT(student_id, day, question_key) DO UPDATE SET
    seconds = seconds + excluded.seconds, updated_at = MAX(updated_at, excluded.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS student_activity_timer_update AFTER UPDATE ON student_question_timers
BEGIN
  INSERT INTO student_daily_question_activity (student_id, day, question_key, seconds, updated_at)
  VALUES (NEW.student_id, date(NEW.updated_at / 1000, 'unixepoch', '+330 minutes'),
    CASE WHEN NEW.source_type = 'pyq' THEN 'pyq:' || NEW.exam_key || ':' ELSE 'question-bank:' END || NEW.question_id,
    MAX(0, NEW.time_spent_seconds - OLD.time_spent_seconds), NEW.updated_at)
  ON CONFLICT(student_id, day, question_key) DO UPDATE SET
    seconds = seconds + excluded.seconds, updated_at = MAX(updated_at, excluded.updated_at);
END;
