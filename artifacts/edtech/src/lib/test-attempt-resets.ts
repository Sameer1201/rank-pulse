import {REVIEW_BUCKET_REMOVED_IDS_KEY} from './reviewBucket';
export type TestAttemptReset={id:string;source:'regular'|'psu';testId:number;psuId:number|null;resetAt:number;questionIds:number[]};
const cursorKey=(userId:number)=>`rankpulse-test-reset-cursor:${userId}`;
type ResetStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function readTestResetCursor(storage:ResetStorage,userId:number):{resetAt:number;id:string} {
  try {const cursor=JSON.parse(storage.getItem(cursorKey(userId))??'null');
    if(cursor&&Number.isFinite(cursor.resetAt)&&typeof cursor.id==='string')return cursor;
  }catch{ /* Storage is optional; never break online/offline practice. */ }
  return {resetAt:0,id:''};
}
export function applyTestAttemptReset(storage:ResetStorage,userId:number,reset:TestAttemptReset) {
  const cursor=readTestResetCursor(storage,userId);
  if(reset.resetAt<cursor.resetAt||(reset.resetAt===cursor.resetAt&&reset.id<=cursor.id))return false;
  try {
    const key=reset.source==='psu'?`educonnect-test-draft-psu-${reset.psuId}-${reset.testId}`:`educonnect-test-draft-${reset.testId}`;
    const raw=storage.getItem(key);
    if(raw) {
      let draft:{savedAt?:number}|null=null;
      try{draft=JSON.parse(raw);}catch{/* Remove only an unusable draft. */}
      if(!draft||!draft.savedAt||draft.savedAt<=reset.resetAt)storage.removeItem(key);
    }
    let dismissed:unknown=[];
    try{dismissed=JSON.parse(storage.getItem(REVIEW_BUCKET_REMOVED_IDS_KEY)??'[]');}catch{/* Ignore corrupted optional dismissal state. */}
    const removed=new Set(reset.questionIds.map(Number));
    if(Array.isArray(dismissed))storage.setItem(REVIEW_BUCKET_REMOVED_IDS_KEY,JSON.stringify(dismissed.filter(id=>!removed.has(Number(id)))));
    storage.setItem(cursorKey(userId),JSON.stringify({resetAt:reset.resetAt,id:reset.id}));
    return true;
  }catch{return false;}
}
