import { getOfflinePack, getOfflineAttempts, submitOffline, packKey, offlineChanged, gradeOffline, type OfflinePack, type OfflineQuestion } from './offline-practice';
import { readOffline, writeOffline, updateOffline } from './offline-store';
import { questionTimerStorageKey, readQuestionTimerSeconds, writeQuestionTimerSeconds } from './question-timer';
import { isStudentFeatureLocked, isStudentPendingVerification, isStudentRejectedVerification } from './student-access';

export function practiceUser() {
  try { const user=JSON.parse(localStorage.getItem('educonnect_user')||'null');
    return user?.role==='student'&&!isStudentPendingVerification(user)&&!isStudentRejectedVerification(user)?user:null;
  } catch { return null; }
}
const urlOf=(path:string)=>new URL(path,'https://practice.local');
const sourceOf=(path:string):OfflinePack['source']|null=>path.startsWith('/question-bank')?'question-bank':path.startsWith('/pyq/')?'pyq':null;
export const isPracticeRequest=(path:string)=>Boolean(sourceOf(path));
export function isBufferedContentRequest(path:string) {
  const url=urlOf(path);
  return /^\/question-bank\/questions\/\d+\/image$/.test(url.pathname) ||
    (/^\/question-bank\/chapters\/\d+\/questions$/.test(url.pathname) && url.searchParams.get('indexOnly')!=='1' &&
      (url.searchParams.has('questionIds')||url.searchParams.has('questionId')));
}
async function context(path:string) {
  const user=practiceUser(), source=sourceOf(path);
  if(!user||!source||isStudentFeatureLocked(user,source))return null;
  const pack=await getOfflinePack(user.id);
  if(!pack||pack.source!==source||Date.now()-pack.createdAt>30*86400000)return null;
  const exam=urlOf(path).searchParams.get('exam');
  if(exam&&!pack.questions.some(q=>q.exam.toLowerCase()===exam.toLowerCase()))return null;
  const chapter=path.match(/^\/question-bank\/chapters\/(\d+)\//)?.[1];
  if(chapter&&pack.context.split(':').at(-1)!==chapter)return null;
  return {user,pack};
}
const snapshotKey=(id:number,path:string)=>`${id}:practice-read:${path}`;
function snapshotAllowed(path:string) {
  const url=urlOf(path);
  return /^\/question-bank\/exams\/[^/]+\/structure$/.test(url.pathname)
    || (/^\/question-bank\/chapters\/\d+\/questions$/.test(url.pathname)&&url.searchParams.get('indexOnly')==='1')
    || url.pathname==='/pyq/questions';
}
/** Keep navigation metadata, never a second unbounded copy of question content. */
export async function cachePracticeRead(path:string,data:any,userId:number|undefined) {
  if(!userId||practiceUser()?.id!==userId)return;
  const url=urlOf(path);
  if(isBufferedContentRequest(path)) {
    const ctx=await context(path);
    if(!ctx)return;
    const image=url.pathname.match(/^\/question-bank\/questions\/(\d+)\/image$/);
    let changed=false;
    await updateOffline<OfflinePack>(packKey(userId),current=>{
      if(current?.id!==ctx.pack.id||practiceUser()?.id!==userId)return current;
      const questions=current.questions.map(q=>{
        let updated:OfflineQuestion=q;
        if(image&&q.id===Number(image[1])) {
          // External media still needs the refill's embedding step before it
          // replaces an offline-ready data URL.
          const safe=(src:string|null|undefined)=>!src||/^data:image\//i.test(src);
          if(safe(data.imageData)&&(data.optionImages??[]).every(safe))updated={...q,imageData:data.imageData,optionImages:data.optionImages??[]};
        } else if(!image) {
          const fresh=data.questions?.find((entry:any)=>entry.id===q.id);
          if(fresh)updated={...q,question:fresh.question,questionType:fresh.questionType,options:fresh.options,
            correctAnswer:fresh.correctAnswer,correctAnswerMulti:fresh.correctAnswerMulti,
            answerText:fresh.answer,answerMin:fresh.correctAnswerMin,answerMax:fresh.correctAnswerMax,
            explanation:fresh.explanation,timeSpentSeconds:fresh.timeSpentSeconds,
            attempted:(fresh.progress?.attemptCount??0)>0,
            view:{...q.view,difficulty:fresh.difficulty,points:fresh.points,topicTag:fresh.topicTag,isSaved:fresh.isSaved,progress:fresh.progress},
            ...(!fresh.hasImage?{imageData:null}:{}),...(!fresh.hasOptionImages?{optionImages:[]}:{})};
        }
        if(JSON.stringify(updated)!==JSON.stringify(q))changed=true;
        return updated;
      });
      return changed?{...current,questions}:current;
    });
    if(changed)offlineChanged();
    return;
  }
  if(!snapshotAllowed(path))return;
  const value=urlOf(path).pathname==='/pyq/questions'?{...data,questions:data.questions?.map((q:any)=>({id:q.id,exam:q.exam,subject:q.subject,chapter:q.chapter,year:q.year,marks:q.marks,questionNumber:q.questionNumber,questionType:q.questionType,isSaved:q.isSaved,progress:q.progress,timeSpentSeconds:q.timeSpentSeconds}))}:data;
  await writeOffline(snapshotKey(userId,path),{at:Date.now(),data:value});
}
export function bufferedQuestionView(q:OfflineQuestion,saved?:Awaited<ReturnType<typeof getOfflineAttempts>>[number]) {
  const base=q.view??{};
  const correct=saved?gradeOffline(q,saved.answer):null;
  const progress=saved?{attemptCount:Math.max(1,Number((base.progress as any)?.attemptCount??0)+(saved.status==='pending'?1:0)),correctCount:correct?1:0,incorrectCount:correct?0:1,lastIsCorrect:correct,firstAttemptedAt:saved.attemptedAt,lastAttemptedAt:saved.attemptedAt,solvedAt:correct?saved.attemptedAt:null}:base.progress;
  return {...base,...q,answer:q.answerText,correctAnswerMin:q.answerMin,correctAnswerMax:q.answerMax,
    hasImage:!!q.imageData,hasOptionImages:q.optionImages?.some(Boolean),progress,
    timeSpentSeconds:saved?.firstSubmissionTime??q.timeSpentSeconds,
    offlineAnswer:saved?.answer,offlineCorrect:correct,
    ...(q.jamSolutionMode&&saved?{jamSubmitted:true,jamSubmittedAnswer:saved.answer,jamSubmittedCorrect:correct}:{})};
}
export async function offlineQuestion(pack:OfflinePack,q:OfflineQuestion) {
  const saved=(await getOfflineAttempts(pack.userId)).find(a=>a.packId===pack.id&&a.questionId===q.id&&a.exam===q.exam);
  return bufferedQuestionView(q,saved);
}
export async function readPracticeFallback(path:string):Promise<any> {
  const ctx=await context(path);if(!ctx)throw Error('Connect to load this question.');
  const {user,pack}=ctx,url=urlOf(path);
  const image=url.pathname.match(/^\/question-bank\/questions\/(\d+)\/image$/);
  if(image){const q=pack.questions.find(q=>q.id===Number(image[1]));if(!q)throw Error('Connect to load this question.');return {imageData:q.imageData,optionImages:q.optionImages??[]};}
  if(/^\/question-bank\/chapters\/\d+\/questions$/.test(url.pathname)&&url.searchParams.get('indexOnly')!=='1'){
    const ids=(url.searchParams.get('questionIds')??url.searchParams.get('questionId')??'').split(',').map(Number);
    const questions=ids.map(id=>pack.questions.find(q=>q.id===id));
    if(questions.some(q=>!q))throw Error('Connect to load this question.');
    return {questions:await Promise.all(questions.map(q=>offlineQuestion(pack,q!)))};
  }
  if(!snapshotAllowed(path))throw Error('This action needs an internet connection.');
  const snapshot=await readOffline<{at:number;data:any}>(snapshotKey(user.id,path));
  if(!snapshot||Date.now()-snapshot.at>30*86400000)throw Error('Connect to load this page.');
  if(Array.isArray(snapshot.data.questions))return {...snapshot.data,questions:await Promise.all(snapshot.data.questions.map(async(meta:any)=>{
    const q=pack.questions.find(q=>q.id===meta.id&&(!meta.exam||q.exam===meta.exam));
    return q?{...meta,...await offlineQuestion(pack,q)}:{...meta,offlineUnavailable:true,question:'Connect to load this question.',options:[]};
  }))};
  return snapshot.data;
}
export async function offlinePracticeWrite(path:string,body:any):Promise<any> {
  const ctx=await context(path);if(!ctx)throw Error('Connect to save this answer.');
  const {user,pack}=ctx;
  const match=path.match(/^\/(?:question-bank-questions|question-bank\/questions|pyq\/questions)\/(\d+)\/(attempt|jam-submit|time)$/);
  if(!match)throw Error('This action needs an internet connection.');
  const q=pack.questions.find(q=>q.id===Number(match[1])&&(!body.exam||q.exam.toLowerCase()===String(body.exam).toLowerCase()));
  if(!q)throw Error('Connect to load this question.');
  const key=questionTimerStorageKey(user.id,pack.source,q.exam,q.id);
  if(match[2]==='time'){
    const seconds=q.attempted?q.timeSpentSeconds??0:Math.max(q.timeSpentSeconds??0,readQuestionTimerSeconds(key),Number(body.timeSpentSeconds)||0);
    writeQuestionTimerSeconds(key,seconds);return {timeSpentSeconds:seconds};
  }
  const saved=await submitOffline(pack,q,body.answer,readQuestionTimerSeconds(key),body.offlineSubmissionId,body.attemptedAt);
  const merged=await offlineQuestion(pack,q);
  return {isCorrect:saved.isCorrect,progress:merged.progress,submitted:true,answer:saved.answer,offlineSaved:true};
}

/** A receipt is attached before sending so a lost online response can be queued
 * using the SAME ID, without incrementing the server twice. */
export async function practiceReceipt(path:string,body:any) {
  if(!/\/(attempt|jam-submit)$/.test(path)||!await context(path))return body;
  return {...body,offlineSubmissionId:body.offlineSubmissionId??crypto.randomUUID(),offlineUserId:practiceUser()?.id,attemptedAt:body.attemptedAt??Date.now()};
}

export async function recordOnlinePracticeResult(path:string,body:any,result:any,userId:number|undefined){
  if(!userId||practiceUser()?.id!==userId)return;
  const match=path.match(/\/(\d+)\/(attempt|jam-submit)$/);if(!match)return;
  const ctx=await context(path);if(!ctx)return;
  const q=ctx.pack.questions.find(q=>q.id===Number(match[1])&&(!body.exam||q.exam.toLowerCase()===String(body.exam).toLowerCase()));
  if(!q)return;
  const updated={...q,attempted:true,timeSpentSeconds:q.attempted?q.timeSpentSeconds:readQuestionTimerSeconds(questionTimerStorageKey(userId,ctx.pack.source,q.exam,q.id)),view:{...q.view,progress:result.progress??q.view?.progress},
    ...(match[2]==='jam-submit'?{jamSubmitted:true,jamSubmittedAnswer:result.answer,jamSubmittedCorrect:result.isCorrect}:{})};
  await updateOffline<OfflinePack>(packKey(userId),current=>current?.id===ctx.pack.id&&practiceUser()?.id===userId
    ?{...current,questions:current.questions.map(item=>item.id===q.id?updated:item)}:current);
  offlineChanged();
}
