/** A receipt and its progress increment are committed in the SAME SQL write.
 * Keep receipts across later online attempts, so a lost response can be replayed safely. */
export function offlineAttemptSql(sql: string, table: "question_bank_question_progress" | "pyq_question_progress") {
  return sql.replace(/\)\s+VALUES/, ", offline_submission_ids) VALUES")
    .replace(/\)\s+ON CONFLICT/, ", json_array(?)) ON CONFLICT")
    .replace("last_answer = excluded.last_answer", `last_answer = CASE WHEN excluded.last_attempted_at >= ${table}.last_attempted_at THEN excluded.last_answer ELSE ${table}.last_answer END`)
    .replace("last_is_correct = excluded.last_is_correct", `last_is_correct = CASE WHEN excluded.last_attempted_at >= ${table}.last_attempted_at THEN excluded.last_is_correct ELSE ${table}.last_is_correct END`)
    .replace("last_attempted_at = excluded.last_attempted_at", `first_attempted_at = MIN(${table}.first_attempted_at, excluded.first_attempted_at), last_attempted_at = MAX(${table}.last_attempted_at, excluded.last_attempted_at)`)
    .replace(/\s+RETURNING/, `,
      offline_submission_ids = json_insert(${table}.offline_submission_ids, '$[#]', json_extract(excluded.offline_submission_ids, '$[0]'))
      WHERE NOT EXISTS (SELECT 1 FROM json_each(${table}.offline_submission_ids)
        WHERE value = json_extract(excluded.offline_submission_ids, '$[0]'))
      RETURNING`);
}

export function readOfflineSubmission(body: Record<string, unknown>, now = Date.now()) {
  if (body.offlineSubmissionId === undefined) return null;
  if (typeof body.offlineSubmissionId !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(body.offlineSubmissionId)) {
    throw new Error("Invalid offline submission ID");
  }
  const at = Number(body.attemptedAt);
  if (!Number.isSafeInteger(at) || at < now - 31 * 86400000 || at > now + 300000) {
    throw new Error("Offline answer timestamp is invalid or more than 31 days old");
  }
  return { id: body.offlineSubmissionId, at: Math.min(at, now) };
}
