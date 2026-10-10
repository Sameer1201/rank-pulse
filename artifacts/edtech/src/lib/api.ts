import { buildApiUrl } from "@/lib/api-origin";
import { cachePracticeRead, readPracticeFallback, offlinePracticeWrite, practiceReceipt, practiceUser, recordOnlinePracticeResult, isPracticeRequest } from './practice-transport';
import { practiceDeadline, practiceNetworkSlow, practiceNetworkHealthy, PRACTICE_READ_WAIT_MS, PRACTICE_WRITE_WAIT_MS, PRACTICE_DOWNLOAD_WAIT_MS } from './practice-network';

export type PracticeReadOptions = { networkOnly?: boolean; signal?: AbortSignal };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const downloads = new Map<string,Promise<any>>();

async function req<T = any>(path: string, options?: RequestInit, readOptions: PracticeReadOptions = {}): Promise<T> {
  const userId=practiceUser()?.id;
  const method=options?.method??'GET';
  let body=typeof options?.body==='string'?JSON.parse(options.body):undefined;
  if(method==='POST'&&body){body=await practiceReceipt(path,body);options={...options,body:JSON.stringify(body)};}
  const fallback=async()=>{
    if(!userId||practiceUser()?.id!==userId)throw Error('Sign in to the original account to use buffered practice.');
    const data=await (method==='GET'?readPracticeFallback(path):offlinePracticeWrite(path,body??{}));
    if(practiceUser()?.id!==userId)throw Error('Practice account changed.');
    return data;
  };
  const practice=Boolean(userId)&&isPracticeRequest(path);
  if(!navigator.onLine&&!readOptions.networkOnly)return fallback();
  // Revalidate online content, including ready questions and media. The page
  // can display its buffer while this bounded read checks for teacher edits.
  let cached: any;
  if(practice&&method==='GET'&&!readOptions.networkOnly){try{cached=await fallback();}catch{/* no metadata snapshot */}}
  let responseStatus=0;
  const fetchResponse=async(signal?:AbortSignal)=>{
    const response=await fetch(buildApiUrl(`/api${path}`),{credentials:'include',...options,signal:signal??options?.signal});
    responseStatus=response.status;
    if(!response.ok){
      const err=await response.json().catch(()=>({error:response.statusText}));
      throw new ApiError(err?.error??`HTTP ${response.status}`,response.status);
    }
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  };
  const started=Date.now();
  let data:any;
  try {
    const bounded=practice||readOptions.networkOnly;
    const wait=readOptions.networkOnly?PRACTICE_DOWNLOAD_WAIT_MS:method==='GET'
      ?(cached===undefined?12000:PRACTICE_READ_WAIT_MS)
      :path.endsWith('/time')?PRACTICE_READ_WAIT_MS:PRACTICE_WRITE_WAIT_MS;
    data=bounded?await practiceDeadline(fetchResponse,wait,readOptions.signal??options?.signal):await fetchResponse();
  } catch (error) {
    if(readOptions.signal?.aborted||options?.signal?.aborted)throw error;
    // Even if the rejection BODY stalls, received denial headers are authoritative.
    if(responseStatus>=400&&responseStatus<500&&![408,429].includes(responseStatus))
      throw error instanceof ApiError?error:new ApiError(`HTTP ${responseStatus}`,responseStatus);
    // Never turn a permission/validation rejection into a successful local save.
    if(error instanceof ApiError && ![408,429].includes(error.status) && error.status<500)throw error;
    if(practice)practiceNetworkSlow();
    if(!readOptions.networkOnly&&practice){
      // A timed-out write may already have committed. Replay only its original receipt.
      if(method!=='GET'&&/\/(attempt|jam-submit)$/.test(path)&&!body?.offlineSubmissionId)throw error;
      if(cached!==undefined&&practiceUser()?.id===userId)return cached;
      return fallback();
    }
    throw error;
  }
  if(practice&&practiceUser()?.id!==userId)throw Error('Practice account changed.');
  if(practice){if(Date.now()-started<=PRACTICE_READ_WAIT_MS)practiceNetworkHealthy();else practiceNetworkSlow();}
  if(method==='GET')await cachePracticeRead(path,data,userId).catch(()=>{});
  if(method==='POST')await recordOnlinePracticeResult(path,body,data,userId).catch(()=>{});
  return data as T;
}

export const api = {
  get: <T = any>(path: string, options: PracticeReadOptions = {}):Promise<T> => {
    // Coalesce identical unsignalled reads; cancellable refills own their request.
    const userId=practiceUser()?.id;
    if(options.signal||!userId||!isPracticeRequest(path))return req<T>(path,undefined,options);
    const key=JSON.stringify([userId,path,Boolean(options.networkOnly)]);
    if(!downloads.has(key))downloads.set(key,req<T>(path,undefined,options).finally(()=>downloads.delete(key)));
    return downloads.get(key)!;
  },
  post: <T = any>(path: string, body?: unknown) =>
    req<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T = any>(path: string, body?: unknown) =>
    req<T>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T = any>(path: string) => req<T>(path, { method: "DELETE" }),
};
