type Row = Record<string, unknown>;
type Value = string | number | null;
export type ResetStatement = {sql: string; params: Value[]};
export type ResetStore = {all(sql: string, params?: Value[]): Promise<Row[]>; batch(statements: ResetStatement[]): Promise<void>};
export class TestResetError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
const fail = (status: number, message: string): never => {throw new TestResetError(status,message);};
function positive(value: unknown) {const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:fail(400,'Invalid test, student or attempt ID');}
function jsonArray(value: unknown): unknown[] {try {const parsed=JSON.parse(String(value??'[]'));return Array.isArray(parsed)?parsed:[];}catch{return [];}}
async function requireStudent(main: ResetStore, studentId: number) {
  const rows=await main.all("SELECT id FROM users WHERE id=? AND role='student'",[studentId]);
  if(!rows.length)fail(404,'Student not found');
}
export async function listAttemptedTests(main: ResetStore, psu: ResetStore|null, studentId: number, limit=30, offset=0,search='') {
  positive(studentId);await requireStudent(main,studentId);
  limit=Number.isFinite(limit)?Math.min(50,Math.max(1,Math.floor(limit))):30;
  offset=Number.isFinite(offset)?Math.max(0,Math.floor(offset)):0;
  const regular=await main.all(`SELECT t.id AS testId,t.title,g.attemptCount,g.latestAttemptId,g.submittedAt,a.percentage
    FROM (SELECT test_id,COUNT(*) AS attemptCount,MAX(id) AS latestAttemptId,MAX(submitted_at) AS submittedAt
      FROM test_submissions WHERE student_id=? GROUP BY test_id) g
    JOIN tests t ON t.id=g.test_id JOIN test_submissions a ON a.id=g.latestAttemptId`,[studentId]);
  let psuUnavailable=false,other: Row[]=[];
  try {
    if(!psu)throw Error('PSU unavailable');
    other=await psu.all(`SELECT t.id AS testId,t.psu_id AS psuId,t.title,g.attemptCount,g.latestAttemptId,g.submittedAt,a.percentage
      FROM (SELECT test_id,COUNT(*) AS attemptCount,MAX(id) AS latestAttemptId,MAX(submitted_at) AS submittedAt
        FROM psu_test_attempts WHERE student_id=? GROUP BY test_id) g
      JOIN psu_tests t ON t.id=g.test_id JOIN psu_test_attempts a ON a.id=g.latestAttemptId`,[studentId]);
  }catch{psuUnavailable=true;}
  // Keep interrupted cross-database resets visible so an admin can safely retry
  // even after the remote attempts have already been cleared.
  if(psu&&!psuUnavailable) {
    const pending=await main.all(`SELECT test_id,psu_id,original_submissions_json FROM test_attempt_reset_audit
      WHERE student_id=? AND source='psu' AND status='prepared' ORDER BY reset_at DESC`,[studentId]);
    const seen=new Set(other.map(row=>Number(row.testId)));
    for(const row of pending) {
      const id=Number(row.test_id);if(seen.has(id))continue;seen.add(id);
      const attempts=jsonArray(row.original_submissions_json) as Row[],last=attempts.at(-1);
      if(!last)continue;
      const [test]=await psu.all('SELECT title FROM psu_tests WHERE id=?',[id]);if(!test)continue;
      other.push({testId:id,psuId:row.psu_id,title:test.title,attemptCount:attempts.length,latestAttemptId:last.id,submittedAt:last.submitted_at,percentage:last.percentage??0});
    }
  }
  const iso=(value: unknown) => {if(value==null)return null;const date=new Date(typeof value==='number'?value:String(value).replace(' ','T')+(String(value).includes('Z')?'':'Z'));return Number.isFinite(date.getTime())?date.toISOString():null;};
  const combined: Array<Row&{source:string}>=[...regular.map(row=>({...row,source:'regular',psuId:null})),...other.map(row=>({...row,source:'psu'}))];
  const items=combined.map(row=>({...row,submittedAt:iso(row.submittedAt)}) as Row&{source:string;submittedAt:string|null})
    .filter(row=>String(row.title??'').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b)=>(b.submittedAt??'').localeCompare(a.submittedAt??'')||Number(b.testId)-Number(a.testId)||a.source.localeCompare(b.source));
  return {items:items.slice(offset,offset+limit),total:items.length,hasMore:offset+limit<items.length,psuUnavailable};
}
function cleanupStatements(studentId: number, prefixes: string[], questionIds: number[], guard='1', guardParams: Value[]=[]): ResetStatement[] {
  const statements: ResetStatement[]=[{
    sql:`DELETE FROM student_daily_question_activity WHERE student_id=? AND EXISTS
      (SELECT 1 FROM json_each(?) WHERE substr(question_key,1,length(value))=value) AND ${guard}`,
    params:[studentId,JSON.stringify(prefixes),...guardParams],
  }];
  if(questionIds.length)statements.push({
    sql:`UPDATE users SET student_profile_data=json_set(CASE WHEN json_valid(student_profile_data) THEN student_profile_data ELSE '{}' END,
      '$.reviewBucketDismissedQuestionIds',json(COALESCE((SELECT json_group_array(value) FROM json_each(
        CASE WHEN json_valid(student_profile_data) THEN json_extract(student_profile_data,'$.reviewBucketDismissedQuestionIds') ELSE '[]' END)
        WHERE CAST(value AS INTEGER) NOT IN (SELECT value FROM json_each(?))),'[]'))),
      review_bucket_dismissed_question_ids=COALESCE((SELECT json_group_array(value) FROM json_each(
        CASE WHEN json_valid(review_bucket_dismissed_question_ids) THEN review_bucket_dismissed_question_ids ELSE '[]' END)
        WHERE CAST(value AS INTEGER) NOT IN (SELECT value FROM json_each(?))),'[]') WHERE id=? AND ${guard}`,
    params:[JSON.stringify(questionIds),JSON.stringify(questionIds),studentId,...guardParams],
  });
  for(const table of ['student_dashboard_cache','student_daily_activity_cache'])statements.push({
    sql:`UPDATE ${table} SET updated_at=0 WHERE student_id=? AND ${guard}`,params:[studentId,...guardParams],
  });
  return statements;
}
export async function resetTestAttempt(main: ResetStore, psu: ResetStore|null, actorId: number, studentId: number, body: Row) {
  positive(actorId);positive(studentId);await requireStudent(main,studentId);
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Choose a valid test');
  const testId=positive(body.testId),expected=positive(body.latestAttemptId);
  const source:'regular'|'psu'=body.source==='regular'?'regular':body.source==='psu'?'psu':fail(400,'Choose a valid test source');
  const store:ResetStore=source==='regular'?main:(psu??fail(503,'PSU tests are temporarily unavailable'));
  const table=source==='regular'?'test_submissions':'psu_test_attempts';
  const tests=await store.all(`SELECT id${source==='psu'?',psu_id':''} FROM ${source==='regular'?'tests':'psu_tests'} WHERE id=?`,[testId]);
  if(!tests.length)fail(404,'Test not found');
  const attempts=await store.all(`SELECT * FROM ${table} WHERE test_id=? AND student_id=? ORDER BY id`,[testId,studentId]);
  if(!attempts.length) {
    // Finish a recoverable PSU reset if the remote delete succeeded but main cleanup failed.
    const pending=source==='psu'?await main.all(`SELECT * FROM test_attempt_reset_audit WHERE source='psu' AND test_id=? AND student_id=? AND status='prepared' ORDER BY reset_at DESC LIMIT 1`,[testId,studentId]):[];
    if(pending[0]) {
      const row=pending[0],old=jsonArray(row.original_submissions_json) as Row[];
      if(Number(old.at(-1)?.id)!==expected)fail(409,'Refresh the list and confirm the pending reset again.');
      const prefixes=old.map(attempt=>`psu-test:${testId}:${attempt.id}:`);
      await main.batch([...cleanupStatements(studentId,prefixes,[]),{sql:"UPDATE test_attempt_reset_audit SET status='completed' WHERE id=?",params:[String(row.id)]}]);
    }
    return {ok:true,alreadyReset:true,resetAttempts:0,testId,studentId,source};
  }
  if(Number(attempts.at(-1)?.id)!==expected)fail(409,'This student has a newer attempt. Refresh the list and confirm again.');
  const now=Date.now(),resetId=crypto.randomUUID();
  const prefixes=attempts.map(attempt=>`${source==='regular'?'test':'psu-test'}:${testId}:${attempt.id}:`);
  const activity=await main.all(`SELECT * FROM student_daily_question_activity WHERE student_id=? AND EXISTS
    (SELECT 1 FROM json_each(?) WHERE substr(question_key,1,length(value))=value)`,[studentId,JSON.stringify(prefixes)]);
  const questionIds=source==='regular'?(await main.all('SELECT id FROM test_questions WHERE test_id=?',[testId])).map(row=>Number(row.id)):
    (await store.all('SELECT question_order FROM psu_test_questions WHERE test_id=?',[testId])).map(row=>testId*1_000_000+Number(row.question_order));
  const guard=`(SELECT MAX(id) FROM ${table} WHERE test_id=? AND student_id=?)=?`;
  const guardParams=[testId,studentId,expected];
  const archive: ResetStatement={sql:`INSERT INTO test_attempt_reset_audit
    (id,source,test_id,psu_id,student_id,reset_by,reset_at,status,original_submissions_json,activity_snapshot_json,question_ids_json)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${source==='regular'?guard:'1'}`,
    params:[resetId,source,testId,source==='psu'?Number(tests[0].psu_id):null,studentId,actorId,now,source==='regular'?'completed':'prepared',
      JSON.stringify(attempts),JSON.stringify(activity),JSON.stringify(questionIds),...(source==='regular'?guardParams:[])],
  };
  if(source==='regular') {
    await main.batch([archive,...cleanupStatements(studentId,prefixes,questionIds,guard,guardParams),{
      sql:`DELETE FROM test_submissions WHERE test_id=? AND student_id=? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`,
      params:[testId,studentId,JSON.stringify(attempts.map(row=>row.id)),...guardParams],
    }]);
    if(!(await main.all('SELECT id FROM test_attempt_reset_audit WHERE id=?',[resetId])).length)fail(409,'A newer attempt arrived. Nothing was reset; refresh and confirm again.');
  }else {
    // Cross-database reset: archive first, delete only the guarded remote attempts,
    // then complete main cleanup. A retry resumes a prepared archive safely.
    await main.batch([archive]);
    await store.batch([
      {sql:`DELETE FROM psu_test_review_dismissals WHERE test_id=? AND student_id=? AND ${guard}`,params:[testId,studentId,...guardParams]},
      {sql:`DELETE FROM psu_test_attempts WHERE test_id=? AND student_id=? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`,
        params:[testId,studentId,JSON.stringify(attempts.map(row=>row.id)),...guardParams]},
    ]);
    if((await store.all('SELECT id FROM psu_test_attempts WHERE test_id=? AND student_id=? AND id IN (SELECT value FROM json_each(?))',[testId,studentId,JSON.stringify(attempts.map(row=>row.id))])).length)
      fail(409,'A newer attempt arrived. Refresh the list and confirm again.');
    await main.batch([...cleanupStatements(studentId,prefixes,[]),{sql:"UPDATE test_attempt_reset_audit SET status='completed' WHERE id=?",params:[resetId]}]);
  }
  return {ok:true,resetAttempts:attempts.length,testId,studentId,source};
}
export async function readStudentTestResets(main: ResetStore, studentId: number, since=0,afterId='') {
  since=Number.isFinite(since)?Math.max(0,Math.floor(since)):0;
  const rows=await main.all(`SELECT id,source,test_id AS testId,psu_id AS psuId,reset_at AS resetAt,question_ids_json
    FROM test_attempt_reset_audit WHERE student_id=? AND status='completed' AND (reset_at>? OR (reset_at=? AND id>?)) ORDER BY reset_at,id LIMIT 201`,[studentId,since,since,afterId.slice(0,80)]);
  const page=rows.slice(0,200),last=page.at(-1);
  return {items:page.map(({question_ids_json,...row})=>({...row,questionIds:jsonArray(question_ids_json)})),hasMore:rows.length>200,
    nextCursor:last?{resetAt:Number(last.resetAt),id:String(last.id)}:null};
}
export function remoteResetStore(url: string, token: string): ResetStore {
  const request=async(body: Row) => {
    const response=await fetch(url.replace(/\/$/,'')+'/query',{method:'POST',headers:{'Content-Type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const payload=await response.json() as {ok?:boolean;results?:Row[]};
    if(!response.ok||!payload.ok)throw new TestResetError(503,'Remote test data is temporarily unavailable');
    return payload.results??[];
  };
  return {all:(sql,params=[])=>request({method:'all',sql,params}),batch:async statements=>{await request({method:'batch',statements});}};
}
