-- Supports keyset pagination for the admin QBank report queue.
CREATE INDEX IF NOT EXISTS "question_bank_reports_created_at_id_idx"
  ON "question_bank_reports" ("created_at" DESC, "id" DESC);
