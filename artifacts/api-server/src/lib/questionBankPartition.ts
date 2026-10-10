/** Check membership only for the selected progress/report row, not every bank
 * question. All column names and IDs come from internal routing configuration.
 * NOT EXISTS preserves legacy orphan rows on the source shard, as NOT IN did
 * with the non-null question primary key.
 */
export function questionBankMembershipPredicate(table: string, column: 'subject_id' | 'class_id', ids: readonly number[], included: boolean, matching = true) {
  const values = ids.length ? ids.join(', ') : '-1';
  const match = `${column} ${matching ? 'IN' : 'NOT IN'} (${values})`;
  if (table === 'question_bank_questions') return `${column} ${included ? 'IN' : 'NOT IN'} (${values})`;
  const questionColumn = table === 'test_question_bank_links' ? 'question_bank_question_id' : 'question_id';
  return `${included ? '' : 'NOT '}EXISTS (SELECT 1 FROM question_bank_questions AS shard_question
    WHERE shard_question.id = ${questionColumn} AND shard_question.${match})`;
}
