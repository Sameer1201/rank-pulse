// Catalog totals are maintained by 0002_read_efficiency.sql in the JAM database.
// CROSS JOIN keeps the indexed student-progress lookup as the outer loop;
// otherwise SQLite can reorder the join and scan the entire exam's questions.
export const JAM_PYQ_SUBJECTS_SQL = `
  SELECT catalog.exam, catalog.subject, SUM(catalog.question_count) AS questionCount,
    COUNT(DISTINCT NULLIF(catalog.chapter, '')) AS chapterCount,
    COALESCE(MAX(attempts.attemptedCount), 0) AS attemptedCount
  FROM jam_pyq_catalog_counts catalog
  LEFT JOIN (
    SELECT q.exam, q.subject, COUNT(*) AS attemptedCount
    FROM pyq_question_progress progress INDEXED BY jam_pyq_progress_student_question_idx
    CROSS JOIN pyq_questions q
    WHERE progress.student_id = ? AND q.id = progress.question_id AND q.exam = ?
    GROUP BY q.exam, q.subject
  ) attempts ON attempts.exam = catalog.exam AND attempts.subject = catalog.subject
  WHERE catalog.exam = ?
  GROUP BY catalog.exam, catalog.subject
  ORDER BY catalog.subject COLLATE NOCASE ASC, catalog.exam COLLATE NOCASE ASC`;

export const JAM_PYQ_CHAPTERS_SQL = `
  SELECT CASE WHEN catalog.chapter = '' THEN 'General' ELSE catalog.chapter END AS chapter,
    MIN(catalog.chapter_order) AS chapterOrder, SUM(catalog.question_count) AS questionCount,
    COALESCE(MAX(attempts.attemptedCount), 0) AS attemptedCount
  FROM jam_pyq_catalog_counts catalog
  LEFT JOIN (
    SELECT CASE WHEN q.chapter = '' THEN 'General' ELSE q.chapter END AS chapter,
      COUNT(*) AS attemptedCount
    FROM pyq_question_progress progress INDEXED BY jam_pyq_progress_student_question_idx
    CROSS JOIN pyq_questions q
    WHERE progress.student_id = ? AND q.id = progress.question_id AND q.exam = ? AND q.subject = ?
    GROUP BY CASE WHEN q.chapter = '' THEN 'General' ELSE q.chapter END
  ) attempts ON attempts.chapter = CASE WHEN catalog.chapter = '' THEN 'General' ELSE catalog.chapter END
  WHERE catalog.exam = ? AND catalog.subject = ?
  GROUP BY CASE WHEN catalog.chapter = '' THEN 'General' ELSE catalog.chapter END
  ORDER BY chapterOrder ASC, chapter COLLATE NOCASE ASC`;
