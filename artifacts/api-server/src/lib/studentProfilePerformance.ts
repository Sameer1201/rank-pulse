type Row = Record<string, unknown>;
export type ProfilePyqStore = 'main' | 'gate' | 'jam';
type MetadataDb = {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
};

// Progress lives in separate content databases; catalog names live in the main
// database. Resolve only IDs this student has attempted, never scan questions.
export async function readProfileQuestionBankPerformance(db: MetadataDb, progress: Row[]) {
  const attemptedRows = progress.filter(row => Number(row.attempt_count ?? row.attemptCount) > 0);
  const ids = (snake: string, camel: string) => [...new Set(attemptedRows
    .map(row => Number(row[snake] ?? row[camel]))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const subjectIds = ids('subject_id', 'subjectId');
  const subjects = subjectIds.length ? await db.prepare('SELECT id, title FROM subjects WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(subjectIds)).all<Row>() : { results: [] };
  const subjectNames = new Map((subjects.results ?? []).map(row => [Number(row.id), String(row.title ?? '').trim()]));
  const groups = new Map<string, { key: string; subject: string; attempted: number; correct: number }>();
  for (const row of attemptedRows) {
    const subjectId = Number(row.subject_id ?? row.subjectId);
    const key = String(subjectId);
    const item = groups.get(key) ?? {
      key,
      subject: subjectNames.get(subjectId) || 'Subject unavailable',
      attempted: 0,
      correct: 0,
    };
    item.attempted += Number(row.attempt_count ?? row.attemptCount) || 0;
    item.correct += Number(row.correct_count ?? row.correctCount) || 0;
    groups.set(key, item);
  }
  // Do not slice individual questions: doing so silently loses most attempts.
  return [...groups.values()].map(item => ({ ...item, accuracy: Math.round(item.correct / item.attempted * 1000) / 10 }))
    .sort((a, b) => b.attempted - a.attempted || a.subject.localeCompare(b.subject));
}

/** Read only this student's lean progress, joining attempted IDs to metadata.
 * Question text, answer keys and images are deliberately not selected. */
export async function readProfilePyqPerformance(
  query: (store: ProfilePyqStore, sql: string, params: (string | number)[]) => Promise<Row[]>,
  studentId: number,
) {
  const unavailable = new Set<string>();
  const label = (store: ProfilePyqStore) => store === 'gate' ? 'GATE' : 'JAM Chemistry';
  const read = async (store: ProfilePyqStore, sql: string, params: (string | number)[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([query(store, sql, params), new Promise<Row[]>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PYQ profile read timed out')), 10_000);
    })]); }
    catch { unavailable.add(label(store)); return []; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const progressSql = `SELECT p.question_id, p.attempt_count, p.correct_count, q.subject
    FROM pyq_question_progress p LEFT JOIN pyq_questions q ON q.id = p.question_id
    WHERE p.student_id = ? AND p.attempt_count > 0`;
  const [gate, jam, submissions] = await Promise.all([
    read('gate', progressSql, [studentId]),
    read('jam', progressSql, [studentId]),
    read('main', 'SELECT question_id, is_correct FROM jam_pyq_submissions WHERE student_id = ?', [studentId]),
  ]);
  // Immutable JAM submissions cover a missing/delayed content-DB projection;
  // a question already in progress is never counted a second time.
  const projected = new Set(jam.map(row => Number(row.question_id)));
  const missing = submissions.filter(row => !projected.has(Number(row.question_id)));
  const metadata = missing.length && !unavailable.has('JAM Chemistry') ? await read('jam',
    'SELECT id, subject FROM pyq_questions WHERE id IN (SELECT value FROM json_each(?))',
    [JSON.stringify(missing.map(row => Number(row.question_id)))]) : [];
  const names = new Map(metadata.map(row => [Number(row.id), row]));
  for (const row of missing) jam.push({ ...names.get(Number(row.question_id)), question_id: row.question_id,
    attempt_count: 1, correct_count: Number(row.is_correct) === 1 ? 1 : 0 });
  const groups = new Map<string, { key: string; exam: string; subject: string; attempted: number; correct: number }>();
  for (const [store, rows] of [['gate', gate], ['jam', jam]] as const) for (const row of rows) {
    const exam = label(store);
    const subject = String(row.subject ?? '').trim() || 'Subject unavailable';
    const key = JSON.stringify([store, subject]);
    const item = groups.get(key) ?? { key, exam, subject, attempted: 0, correct: 0 };
    item.attempted += Number(row.attempt_count) || 0;
    item.correct += Number(row.correct_count) || 0;
    groups.set(key, item);
  }
  return {
    pyqPerformance: [...groups.values()].map(item => ({ ...item, accuracy: Math.round(item.correct / item.attempted * 1000) / 10 }))
      .sort((a, b) => a.exam.localeCompare(b.exam) || b.attempted - a.attempted || a.subject.localeCompare(b.subject)),
    pyqPerformanceUnavailable: [...unavailable],
  };
}
