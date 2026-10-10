import {choicesMatch} from './choice-answer';
import type {ResetStore,ResetStatement} from './testAttemptReset';
type Row=Record<string,unknown>;
export class PyqCorrectionError extends Error {constructor(public status:number,message:string){super(message);}}
function fail(status:number,message:string):never {throw new PyqCorrectionError(status,message);}
const parse=(value:unknown):unknown=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}};
function text(value:unknown,max=2_000_000){if(typeof value!=='string'||value.length>max)fail(400,'Invalid or oversized question content');return value.trim();}
function number(value:unknown){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:fail(400,'Enter a valid numerical answer');}
export async function readEditablePyq(bank:ResetStore,id:number,exam:string){
  if(!Number.isSafeInteger(id)||id<=0||!exam||exam.length>80)fail(400,'A valid question ID and exam are required');
  const [row]=await bank.all('SELECT * FROM pyq_questions WHERE id=? AND exam=?',[id,exam]);
  return row??fail(404,'PYQ question not found in this exam');
}
export function gradeCorrectedPyq(row:Row,value:unknown):boolean|null {
  const answer=parse(value);if(answer==null||answer==='')return null;
  if(row.question_type==='integer'){
    const n=Number(answer);if(!Number.isFinite(n))return false;
    if(row.answer_min!=null&&row.answer_max!=null)return n>=Number(row.answer_min)&&n<=Number(row.answer_max);
    const exact=Number(String(row.answer_text??'').replace(/<[^>]+>/g,'').trim());return Number.isFinite(exact)&&Math.abs(n-exact)<1e-9;
  }
  return choicesMatch(answer,row.question_type==='multi'?row.correct_answer_multi:row.correct_answer,row.question_type==='multi');
}
export async function correctPyqQuestion(bank:ResetStore,main:ResetStore,id:number,exam:string,input:unknown){
  const old=await readEditablePyq(bank,id,exam);
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid question correction');
  const body=input as Row;
  if(body.expectedUpdatedAt==null||String(body.expectedUpdatedAt)!==String(old.updated_at))fail(409,'This question changed. Reload it before saving.');
  const question=text(body.question??old.question),explanation=body.explanation===null?null:text(body.explanation??old.explanation??'')||null;
  if(!question||!question.replace(/<[^>]*>/g,'').trim()&&!/<img\b/i.test(question))fail(400,'Question text or an image is required');
  const kind=body.questionType??old.question_type;if(!['mcq','multi','integer'].includes(String(kind)))fail(400,'Choose MCQ, MSQ or numerical');
  const rawOptions=body.options??parse(old.options_json);if(!Array.isArray(rawOptions))fail(400,'Invalid options');
  const options=rawOptions.map(option=>text(option));
  let answers:number[]=[];let answerText:string|null=null,answerMin:number|null=null,answerMax:number|null=null;
  if(kind==='integer'){
    answerText=text(body.answerText??old.answer_text??'',1000)||null;
    answerMin=number(body.answerMin===undefined?old.answer_min:body.answerMin);answerMax=number(body.answerMax===undefined?old.answer_max:body.answerMax);
    if((answerMin===null)!==(answerMax===null)||answerMin!==null&&answerMax!==null&&answerMin>answerMax)fail(400,'Enter both range bounds, with minimum no greater than maximum');
    if(answerMin===null&&(!answerText||!Number.isFinite(Number(answerText.replace(/<[^>]+>/g,'').trim()))))fail(400,'Enter an exact numerical answer or a valid range');
  }else{
    if(options.length<2||options.length>8||options.some(option=>!option))fail(400,'Provide 2–8 non-empty options');
    const raw=kind==='mcq'?[body.correctAnswer===undefined?old.correct_answer:body.correctAnswer]:body.correctAnswerMulti??parse(old.correct_answer_multi);
    if(!Array.isArray(raw)||!raw.length||raw.some(v=>v==null||v===''||!Number.isInteger(Number(v))||Number(v)<0||Number(v)>=options.length))fail(400,'Select the correct option(s)');
    answers=[...new Set(raw.map(Number))].sort((a,b)=>a-b);
  }
  const imageData=body.imageData===undefined?old.image_data:body.imageData;
  if(imageData!=null&&(typeof imageData!=='string'||imageData.length>6_000_000))fail(400,'Invalid question image');
  const now=Date.now(),version=new Date(now).toISOString();
  const corrected={...old,question,question_type:kind,options_json:JSON.stringify(options),correct_answer:answers[0]??null,correct_answer_multi:JSON.stringify(answers),answer_text:answerText,answer_min:answerMin,answer_max:answerMax,explanation,image_data:imageData??null,updated_at:version};
  await bank.batch([{sql:`UPDATE pyq_questions SET question=?,question_type=?,options_json=?,correct_answer=?,correct_answer_multi=?,answer_text=?,answer_min=?,answer_max=?,explanation=?,image_data=?,updated_at=? WHERE id=? AND exam=? AND updated_at=?`,params:[question,String(kind),corrected.options_json,corrected.correct_answer,corrected.correct_answer_multi,answerText,answerMin,answerMax,explanation,corrected.image_data as string|null,version,id,exam,String(old.updated_at)]}]);
  if(String((await readEditablePyq(bank,id,exam)).updated_at)!==version)fail(409,'Another admin changed this question. Reload it before saving.');
  const progress=await bank.all('SELECT id,student_id,last_answer,last_is_correct FROM pyq_question_progress WHERE question_id=? AND attempt_count>0',[id]);
  const regrades:ResetStatement[]=progress.flatMap(row=>{
    const grade=gradeCorrectedPyq(corrected,row.last_answer);if(grade===null)return [];
    const next=grade?1:0,delta=next-Number(row.last_is_correct??0);
    return [{sql:`UPDATE pyq_question_progress SET last_is_correct=?,correct_count=MAX(0,correct_count+?),incorrect_count=MAX(0,incorrect_count-?),solved_at=CASE WHEN ?=1 THEN COALESCE(solved_at,?) WHEN correct_count+?<=0 THEN NULL ELSE solved_at END WHERE id=? AND question_id=? AND EXISTS(SELECT 1 FROM pyq_questions WHERE id=? AND exam=? AND updated_at=?)`,params:[next,delta,delta,next,now,delta,Number(row.id),id,id,exam,version]}];
  });
  for(let offset=0;offset<regrades.length;offset+=100)await bank.batch(regrades.slice(offset,offset+100));
  const jam=/^jam[\s_-]*chemistry$/i.test(exam.trim());
  const submissions=jam?await main.all('SELECT student_id,answer_json FROM jam_pyq_submissions WHERE question_id=?',[id]):[];
  const mainChanges:ResetStatement[]=[];
  const outcomes=new Map<number,boolean>();
  for(const row of progress){const grade=gradeCorrectedPyq(corrected,row.last_answer);if(grade!==null)outcomes.set(Number(row.student_id),grade);}
  for(const row of submissions){const grade=gradeCorrectedPyq(corrected,row.answer_json);if(grade===null)continue;outcomes.set(Number(row.student_id),grade);
    mainChanges.push({sql:'UPDATE jam_pyq_submissions SET is_correct=? WHERE question_id=? AND student_id=?',params:[grade?1:0,id,Number(row.student_id)]});}
  for(const [studentId,grade] of outcomes){
    mainChanges.push({sql:'UPDATE student_daily_question_activity SET outcome=? WHERE student_id=? AND question_key=? AND outcome!=3',params:[grade?1:0,studentId,`pyq:${jam?'jam-chemistry':'gate'}:${id}`]});
    for(const table of ['student_dashboard_cache','student_daily_activity_cache'])mainChanges.push({sql:`UPDATE ${table} SET updated_at=0 WHERE student_id=?`,params:[studentId]});
  }
  for(let offset=0;offset<mainChanges.length;offset+=100)await main.batch(mainChanges.slice(offset,offset+100));
  // Reports close only after both content and student regrading have succeeded.
  if(String((await readEditablePyq(bank,id,exam)).updated_at)!==version)fail(409,'Another admin changed this question. Reload before completing the fix.');
  await bank.batch([{sql:"UPDATE pyq_reports SET status='resolved',updated_at=? WHERE question_id=? AND status='open' AND EXISTS(SELECT 1 FROM pyq_questions WHERE id=? AND exam=? AND updated_at=?)",params:[now,id,id,exam,version]}]);
  return {ok:true,regradedStudents:outcomes.size};
}
