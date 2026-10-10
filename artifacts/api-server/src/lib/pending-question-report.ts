// Check and insert in one SQLite statement: concurrent requests cannot create
// a second open report for the same student/question. Closed reports remain.
export const pendingReportMessage = "You already reported this question. Please wait for an admin response before reporting it again.";
export const questionBankReportInsert = `INSERT INTO question_bank_reports
 (question_id, class_id, subject_id, chapter_id, reported_by, teacher_id, reason, status, created_at, updated_at)
 SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?
 WHERE NOT EXISTS (SELECT 1 FROM question_bank_reports WHERE question_id = ? AND reported_by = ? AND status = 'open')
 RETURNING id`;
export const pyqReportInsert = `INSERT INTO pyq_reports (question_id, reported_by, reason, status, created_at, updated_at)
 SELECT ?, ?, ?, 'open', ?, ?
 WHERE NOT EXISTS (SELECT 1 FROM pyq_reports WHERE question_id = ? AND reported_by = ? AND status = 'open')
 RETURNING id`;
export const psuReportInsert = `INSERT INTO psu_question_reports (psu_id, question_id, reported_by, reason)
 SELECT ?, ?, ?, ?
 WHERE NOT EXISTS (SELECT 1 FROM psu_question_reports WHERE psu_id = ? AND question_id = ? AND reported_by = ? AND status = 'open')
 RETURNING id`;
export const testReportInsert = `INSERT INTO test_question_reports
 (test_id, question_id, reported_by, teacher_id, reason, status, teacher_note, created_at, updated_at)
 SELECT ?, ?, ?, ?, ?, 'open', NULL, ?, ?
 WHERE NOT EXISTS (SELECT 1 FROM test_question_reports WHERE question_id = ? AND reported_by = ? AND status = 'open')
 RETURNING id`;
export const psuTestReportInsert = `INSERT INTO psu_test_question_reports (psu_id, test_id, question_order, reported_by, reason)
 VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(test_id, question_order, reported_by) DO UPDATE SET reason = excluded.reason, status = 'open', updated_at = CURRENT_TIMESTAMP
 WHERE psu_test_question_reports.status <> 'open'
 RETURNING id, status, reason`;
