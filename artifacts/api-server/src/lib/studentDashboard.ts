import type { ActivityQuery, ActivityStore } from './studentDailyActivity';
import { answeredQuestionIds, indiaActivityDay } from './studentDailyActivity';

type Row = Record<string, unknown>;
type Source = 'tests' | 'question-bank' | 'pyq' | 'psu';
type Result = { key: string; source: Source; subject: string; topic: string; correct: number; wrong: number; ungraded: number; at: number; path: string };
const number = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const object = (v: unknown): Record<string, unknown> => {
  try { const parsed = typeof v === 'string' ? JSON.parse(v) : v; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
};
const timestamp = (v: unknown) => typeof v === 'number' ? v : Date.parse(String(v).replace(' ', 'T').replace(/(?<!Z)$/, 'Z')) || 0;
const accuracy = (correct: number, wrong: number) => correct + wrong > 0 ? Math.round(correct / (correct + wrong) * 100) : null;
const examKey = (v: unknown) => /jam/i.test(String(v)) ? 'jam-chemistry' : 'gate';

/** Only the signed-in student's lean progress/answer keys. No content, images or peer analyses. */
export async function readStudentDashboard(query: ActivityQuery, studentId: number,
  grade: (question: Row, answer: unknown) => boolean | null, now = Date.now()) {
  const failures = new Set<string>();
  const read = async (store: ActivityStore, sql: string, params: (string | number)[], group: string = store): Promise<Row[]> => {
    try { return await query(store, sql, params); }
    catch (error) { failures.add(group); console.error('Dashboard source unavailable', group, error instanceof Error ? error.message : String(error)); return []; }
  };
  const pyqSql = `SELECT p.question_id, p.last_is_correct, p.last_attempted_at, q.subject, q.chapter, q.exam
    FROM pyq_question_progress p LEFT JOIN pyq_questions q ON q.id = p.question_id
    WHERE p.student_id = ? AND p.attempt_count > 0`;
  const [qb, pyq, jam, submissions, testTime, psu, psuTime, timers, daily, tracking, jamSubmissions, testHistory, psuHistory] = await Promise.all([
    read('question-bank', 'SELECT question_id, class_id, subject_id, chapter_id, last_is_correct, last_attempted_at FROM question_bank_question_progress WHERE student_id = ? AND attempt_count > 0', [studentId]),
    read('pyq', pyqSql, [studentId]), read('jam-pyq', pyqSql, [studentId]),
    read('main', `SELECT s.id, s.test_id, s.answers, s.submitted_at, t.title
      FROM test_submissions s LEFT JOIN tests t ON t.id = s.test_id
      WHERE s.student_id = ? AND NOT EXISTS (SELECT 1 FROM test_submissions newer WHERE newer.student_id = s.student_id
        AND newer.test_id = s.test_id AND (newer.submitted_at > s.submitted_at OR (newer.submitted_at = s.submitted_at AND newer.id > s.id)))`, [studentId], 'tests'),
    read('main', `SELECT COUNT(*) AS completed, COALESCE(SUM((SELECT COALESCE(SUM(MAX(0, CAST(value AS REAL))), 0)
      FROM json_each(COALESCE(question_timings, '{}')) WHERE type IN ('integer','real'))), 0) AS seconds
      FROM test_submissions WHERE student_id = ?`, [studentId], 'tests'),
    read('psu', `SELECT a.test_id, a.psu_id, a.correct_count, a.wrong_count, a.submitted_at, t.title, p.name AS psu_name
      FROM psu_test_attempts a LEFT JOIN psu_tests t ON t.id = a.test_id LEFT JOIN psus p ON p.id = a.psu_id
      WHERE a.student_id = ? AND NOT EXISTS (SELECT 1 FROM psu_test_attempts newer WHERE newer.student_id = a.student_id
        AND newer.test_id = a.test_id AND (newer.submitted_at > a.submitted_at OR (newer.submitted_at = a.submitted_at AND newer.id > a.id)))`, [studentId]),
    read('psu', 'SELECT COUNT(*) AS completed, COALESCE(SUM(total_time_seconds),0) AS seconds FROM psu_test_attempts WHERE student_id = ?', [studentId]),
    read('main', 'SELECT source_type, SUM(time_spent_seconds) AS seconds FROM student_question_timers WHERE student_id = ? GROUP BY source_type', [studentId], 'timers'),
    read('main', 'SELECT day,correct,wrong,unanswered,ungraded,seconds FROM student_daily_activity_totals WHERE student_id = ? AND day <= ? ORDER BY day', [studentId,indiaActivityDay(now).date], 'daily history'),
    read('main', 'SELECT started_at FROM student_activity_tracking WHERE id = 1', [], 'daily history'),
    read('main', 'SELECT question_id, is_correct AS last_is_correct, submitted_at AS last_attempted_at FROM jam_pyq_submissions WHERE student_id = ?', [studentId], 'jam-pyq'),
    read('main', `SELECT s.id, s.test_id, s.score, s.total_points, s.submitted_at, t.title
      FROM test_submissions s LEFT JOIN tests t ON t.id = s.test_id
      WHERE s.student_id = ? ORDER BY s.submitted_at DESC, s.id DESC LIMIT 30`, [studentId], 'test history'),
    read('psu', `SELECT a.id, a.test_id, a.psu_id, a.score, a.total_points, a.submitted_at, t.title
      FROM psu_test_attempts a LEFT JOIN psu_tests t ON t.id = a.test_id
      WHERE a.student_id = ? ORDER BY a.submitted_at DESC, a.id DESC LIMIT 30`, [studentId], 'PSU test history'),
  ]);
  const qbIds = JSON.stringify(qb.map(row => number(row.question_id)));
  const testIds = JSON.stringify(submissions.map(row => number(row.test_id)));
  const projectedJamIds = new Set(jam.map(row=>number(row.question_id)));
  const jamMissing = jamSubmissions.filter(row => !projectedJamIds.has(number(row.question_id)));
  const [qbQuestions, links, structure, testQuestions, jamMetadata] = await Promise.all([
    qb.length ? read('question-bank', 'SELECT id, source_test_id, source_test_question_id FROM question_bank_questions WHERE id IN (SELECT value FROM json_each(?))', [qbIds]) : [],
    submissions.length ? read('question-bank', 'SELECT test_id,test_question_id,question_bank_question_id FROM test_question_bank_links WHERE test_id IN (SELECT value FROM json_each(?))', [testIds]) : [],
    qb.length ? read('main', `SELECT c.id AS chapter_id, c.title AS chapter, s.title AS subject, cl.subject AS exam
      FROM chapters c JOIN subjects s ON s.id=c.subject_id JOIN classes cl ON cl.id=s.class_id
      WHERE c.id IN (SELECT value FROM json_each(?))`, [JSON.stringify([...new Set(qb.map(row=>number(row.chapter_id)))])], 'question-bank') : [],
    submissions.length ? read('main', `SELECT id,test_id,subject_label,meta,question_type,correct_answer,correct_answer_multi,correct_answer_min,correct_answer_max
      FROM test_questions WHERE test_id IN (SELECT value FROM json_each(?))`, [testIds], 'tests') : [],
    jamMissing.length ? read('jam-pyq', 'SELECT id,subject,chapter,exam FROM pyq_questions WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(jamMissing.map(row=>number(row.question_id)))]) : [],
  ]);
  const aliases = new Map<string,string>();
  const canonical = (key:string):string => {
    const parent=aliases.get(key);
    if(!parent || parent===key)return key;
    const root=canonical(parent);aliases.set(key,root);return root;
  };
  const link=(a:string,b:string)=>aliases.set(canonical(a),canonical(b));
  for (const row of links) link(`test:${row.test_id}:${row.test_question_id}`, `qb:${row.question_bank_question_id}`);
  for (const row of qbQuestions) if (row.source_test_id && row.source_test_question_id) link(`test:${row.source_test_id}:${row.source_test_question_id}`, `qb:${row.id}`);
  const chapterMap = new Map(structure.map(row => [number(row.chapter_id),row]));
  const results = new Map<string,Result>();
  const put = (row: Result) => { row.key=canonical(row.key);const old=results.get(row.key); if (!old || row.at >= old.at) results.set(row.key,row); };
  for (const row of qb) {
    const metadata=chapterMap.get(number(row.chapter_id));
    put({key:`qb:${row.question_id}`,source:'question-bank',subject:String(metadata?.subject??'Question Bank'),topic:String(metadata?.chapter??'Practice'),
      correct:number(row.last_is_correct)===1?1:0,wrong:number(row.last_is_correct)===1?0:1,ungraded:0,at:number(row.last_attempted_at),
      path:`/student/question-bank/exam/${examKey(metadata?.exam)}/subject/${row.subject_id}/chapter/${row.chapter_id}/question/${row.question_id}`});
  }
  // Immutable JAM submissions fill in a delayed/missing projection, without double-counting it.
  const jamMap=new Map(jam.map(row=>[number(row.question_id),row]));
  for(const row of jamSubmissions) {
    const id=number(row.question_id), old=jamMap.get(id);
    if(!old || number(row.last_attempted_at)>number(old.last_attempted_at)) jamMap.set(id,{...jamMetadata.find((item: Row)=>number(item.id)===id),...old,...row});
  }
  for(const [store,rows] of [['gate',pyq],['jam-chemistry',[...jamMap.values()]]] as const) for(const row of rows) {
    put({key:`pyq:${store}:${row.question_id}`,source:'pyq',subject:String(row.subject??(store==='gate'?'GATE PYQ':'JAM Chemistry PYQ')),topic:String(row.chapter??'PYQ practice'),
      correct:number(row.last_is_correct)===1?1:0,wrong:number(row.last_is_correct)===1?0:1,ungraded:0,at:number(row.last_attempted_at),path:'/student/pyq'});
  }
  const questionMap=new Map(testQuestions.map(row=>[`${row.test_id}:${row.id}`,row]));
  for(const sub of submissions) {
    const answers=object(sub.answers);
    for(const id of answeredQuestionIds(answers)) {
      const question=questionMap.get(`${sub.test_id}:${id}`);
      const correct=question?grade(question,answers[id]):null;
      const meta=object(question?.meta);
      put({key:`test:${sub.test_id}:${id}`,source:'tests',subject:String(question?.subject_label||meta.subjectName||'Tests'),
        topic:String(meta.chapterName||meta.topicTag||sub.title||'Test practice'),correct:correct===true?1:0,wrong:correct===false?1:0,ungraded:correct===null?1:0,
        at:number(sub.submitted_at),path:`/student/tests/${sub.test_id}/analysis`});
    }
  }
  for(const row of psu) put({key:`psu:${row.test_id}`,source:'psu',subject:String(row.psu_name??'PSU'),topic:String(row.title??'PSU test'),
    correct:number(row.correct_count),wrong:number(row.wrong_count),ungraded:0,at:timestamp(row.submitted_at),path:`/student/psu/${row.psu_id}/tests/${row.test_id}/analysis`});

  const sourceLabels: Record<Source,string> = {tests:'Tests','question-bank':'Question Bank',pyq:'PYQ',psu:'PSU tests'};
  const sources = (Object.keys(sourceLabels) as Source[]).map(key=>({key,label:sourceLabels[key],correct:0,wrong:0,ungraded:0,questions:0,seconds:0,completed:0,accuracy:null as number|null}));
  const subjects=new Map<string,{subject:string;correct:number;wrong:number;ungraded:number;questions:number;sources:Source[]}>();
  const areas=new Map<string,{subject:string;topic:string;correct:number;wrong:number;questions:number;path:string;source:Source}>();
  const recent=new Map<string,{source:Source;title:string;subject:string;at:number;path:string;questions:number;correct:number;wrong:number}>();
  for(const row of results.values()) {
    const count=row.correct+row.wrong+row.ungraded;
    const source=sources.find(item=>item.key===row.source)!;
    source.correct+=row.correct;source.wrong+=row.wrong;source.ungraded+=row.ungraded;source.questions+=count;
    const subject=subjects.get(row.subject)??{subject:row.subject,correct:0,wrong:0,ungraded:0,questions:0,sources:[]};
    subject.correct+=row.correct;subject.wrong+=row.wrong;subject.ungraded+=row.ungraded;subject.questions+=count;
    if(!subject.sources.includes(row.source))subject.sources.push(row.source);
    subjects.set(row.subject,subject);
    const areaKey=`${row.subject}:${row.topic}`;
    const area=areas.get(areaKey)??{subject:row.subject,topic:row.topic,correct:0,wrong:0,questions:0,path:row.path,source:row.source};
    area.correct+=row.correct;area.wrong+=row.wrong;area.questions+=count;areas.set(areaKey,area);
    const recentKey=`${row.source}:${areaKey}`;
    const item=recent.get(recentKey)??{source:row.source,title:row.topic,subject:row.subject,at:row.at,path:row.path,questions:0,correct:0,wrong:0};
    item.questions+=count;item.correct+=row.correct;item.wrong+=row.wrong;
    if(row.at>=item.at){item.at=row.at;item.path=row.path;}recent.set(recentKey,item);
  }
  for(const source of sources) {
    source.seconds=source.key==='tests'?number(testTime[0]?.seconds):source.key==='psu'?number(psuTime[0]?.seconds):number(timers.find(row=>row.source_type===source.key)?.seconds);
    source.completed=source.key==='tests'?number(testTime[0]?.completed):source.key==='psu'?number(psuTime[0]?.completed):0;
    source.accuracy=accuracy(source.correct,source.wrong);
  }
  const totals=sources.reduce((out,source)=>({questions:out.questions+source.questions,correct:out.correct+source.correct,wrong:out.wrong+source.wrong,ungraded:out.ungraded+source.ungraded,seconds:out.seconds+source.seconds,completed:out.completed+source.completed}),{questions:0,correct:0,wrong:0,ungraded:0,seconds:0,completed:0});
  const today=indiaActivityDay(now).date;
  const trackingStartedAt=number(tracking[0]?.started_at);
  const firstDay=trackingStartedAt?indiaActivityDay(trackingStartedAt).date:today;
  const dailyMap=new Map(daily.map(row=>[String(row.day),row]));
  const history=Array.from({length:28},(_,i)=>{
    const date=indiaActivityDay(now-(27-i)*86400000).date,row=dailyMap.get(date);
    const available=trackingStartedAt>0 && date>=firstDay && !failures.has('daily history');
    const correct=available?number(row?.correct):null,wrong=available?number(row?.wrong):null;
    return {date,available,correct,wrong,unanswered:available?number(row?.unanswered):null,seconds:available?number(row?.seconds):null,accuracy:correct!==null&&wrong!==null?accuracy(correct,wrong):null};
  });
  let streak=0;
  for(let offset=number(dailyMap.get(today)?.correct)+number(dailyMap.get(today)?.wrong)+number(dailyMap.get(today)?.ungraded)>0?0:1;offset<=dailyMap.size;offset++){
    const row=dailyMap.get(indiaActivityDay(now-offset*86400000).date);if(!row||number(row.correct)+number(row.wrong)+number(row.ungraded)===0)break;streak++;
  }
  // Bounded, lean score history includes retakes; unlike latest-result question totals.
  const testAttempts = ([['tests', testHistory], ['psu', psuHistory]] as const).flatMap(([source, rows]) => rows.map(row => ({
    id: `${source}:${row.id}`, source, title: String(row.title ?? 'Test'), at: timestamp(row.submitted_at),
    score: number(row.score), totalPoints: number(row.total_points),
    percentage: number(row.total_points) > 0 ? Math.round(number(row.score) / number(row.total_points) * 1000) / 10 : null,
    path: source === 'psu' ? `/student/psu/${row.psu_id}/tests/${row.test_id}/analysis` : `/student/tests/${row.test_id}/analysis`,
  }))).sort((a,b)=>b.at-a.at || b.id.localeCompare(a.id)).slice(0,30).reverse();
  return {generatedAt:new Date(now).toISOString(),scope:'All your exams',partial:failures.size>0,unavailableSources:[...failures],
    totals:{...totals,accuracy:accuracy(totals.correct,totals.wrong)},sources,
    subjects:[...subjects.values()].map(row=>({...row,accuracy:accuracy(row.correct,row.wrong)})).sort((a,b)=>b.questions-a.questions),
    weakAreas:[...areas.values()].map(row=>({...row,accuracy:accuracy(row.correct,row.wrong)})).filter(row=>row.wrong>0).sort((a,b)=>(a.accuracy??100)-(b.accuracy??100)||b.questions-a.questions).slice(0,6),
    recent:[...recent.values()].sort((a,b)=>b.at-a.at).slice(0,8),history,testAttempts,streak,trackingStartedAt,
    notes:['Latest saved result per practice question / latest submission per test; retakes do not inflate question counts.',
      'A test answer mirrored to Question Bank counts once, under the most recent source. Time includes all recorded practice and submitted test sessions.',
      'PSU statistics cover submitted PSU tests. The read-only PSU question library does not record answers.']};
}
