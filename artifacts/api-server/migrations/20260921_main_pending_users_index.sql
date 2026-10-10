-- Speeds up the super-admin pending-student queue without scanning all users.
CREATE INDEX IF NOT EXISTS "users_role_status_created_at_id_idx"
  ON "users" ("role", "status", "created_at", "id");
