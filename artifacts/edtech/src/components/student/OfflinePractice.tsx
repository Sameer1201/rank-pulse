import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { isStudentFeatureLocked, isStudentPendingVerification, isStudentRejectedVerification } from '@/lib/student-access';
import { getOfflinePack, getOfflineAttempts, syncOffline, prepareOfflineBuffer, prepareOfflineShell,
  type OfflinePack, type BufferQuestionLoader, type OfflineAttempt } from '@/lib/offline-practice';
import { weakPracticeConnection } from '@/lib/practice-network';

const capabilities=new Map<string,{available:boolean;at:number}>();

/** Background-only look-ahead: online and offline use the same practice pages. */
export function OfflinePackLoader({context,source,title,exam,questionIds,load}:{
  context:string;source:OfflinePack['source'];title:string;exam:string;
  questionIds:number[];load:BufferQuestionLoader;
}) {
  const {user}=useAuth();
  const [retry,setRetry]=useState(0);
  const loadRef=useRef(load);loadRef.current=load;
  const windowKey=questionIds.slice(0,15).join(',');
  useEffect(()=>{const reconnect=()=>setRetry(n=>n+1);window.addEventListener('online',reconnect);return()=>window.removeEventListener('online',reconnect);},[]);
  useEffect(()=>{
    if(!user||user.role!=='student'||isStudentPendingVerification(user)||isStudentRejectedVerification(user)||isStudentFeatureLocked(user,source))return;
    if(!questionIds.length)return;
    let cancelled=false,failures=0;
    let timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const refill=async()=>{
      let delay=60000;
      try {
        if(!navigator.onLine)return;
        const key=JSON.stringify([user.id,source,exam,context]);
        let capability=capabilities.get(key);
        if(!capability||Date.now()-capability.at>5*60000){
          const data=await api.get<{available:boolean}>(`/student/offline-capabilities?source=${source}&questionId=${questionIds[0]}&exam=${encodeURIComponent(exam)}`,{networkOnly:true,signal:controller.signal});
          capability={...data,at:Date.now()};capabilities.set(key,capability);
        }
        if(cancelled||!capability.available)return;
        // Shell download must not block saving questions on a weak connection.
        void prepareOfflineShell().catch(()=>{});
        await prepareOfflineBuffer({userId:user.id,source,context,title,questionIds},
          (ids,signal,onReady)=>loadRef.current(ids,signal,onReady),()=>!cancelled,controller.signal);
        failures=0;
      } catch {
        // Retry while Wi-Fi remains "online" too. One refill at a time, capped backoff.
        delay=Math.min(30000,3000*2**Math.min(failures++,4));
      } finally {
        if(!cancelled)timer=setTimeout(()=>void refill(),delay);
      }
    };
    void refill();
    return()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[context,source,exam,windowKey,user?.id,retry]);
  return null;
}

/** Synchronization has no separate screen, button, or floating practice bar. */
export function OfflinePracticeManager(){
  const {user}=useAuth();const client=useQueryClient();
  useEffect(()=>{
    const sync=()=>{if(user?.role==='student'&&navigator.onLine)void syncOffline(user.id).catch(()=>{});};
    const synced=()=>{void client.invalidateQueries({predicate:q=>/student-qb|pyq|dashboard|weekly/.test(String(q.queryKey[0]))});};
    const restored=()=>{sync();synced();};
    sync();const timer=setInterval(sync,30000);
    window.addEventListener('online',sync);window.addEventListener('offline-practice-changed',sync);
    window.addEventListener('offline-practice-synced',synced);
    window.addEventListener('practice-network-restored',restored);
    return()=>{clearInterval(timer);window.removeEventListener('online',sync);window.removeEventListener('offline-practice-changed',sync);window.removeEventListener('offline-practice-synced',synced);window.removeEventListener('practice-network-restored',restored);};
  },[user?.id,client]);
  return null;
}

export function useBufferedPractice(){
  const {user}=useAuth();
  const [offline,setOffline]=useState(weakPracticeConnection);
  useEffect(()=>{
    const down=()=>setOffline(true),up=()=>setOffline(weakPracticeConnection());
    window.addEventListener('offline',down);window.addEventListener('online',up);
    window.addEventListener('practice-network-unavailable',down);window.addEventListener('practice-network-restored',up);
    return()=>{window.removeEventListener('offline',down);window.removeEventListener('online',up);window.removeEventListener('practice-network-unavailable',down);window.removeEventListener('practice-network-restored',up);};
  },[]);
  const [state,setState]=useState<{pack?:OfflinePack;attempts:OfflineAttempt[]}>({attempts:[]});
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{if(!user){setState({attempts:[]});return;}const [pack,attempts]=await Promise.all([getOfflinePack(user.id),getOfflineAttempts(user.id)]);if(active)setState({pack,attempts});};
    void refresh().catch(()=>{});
    const changed=()=>void refresh().catch(()=>{});window.addEventListener('offline-practice-changed',changed);
    return()=>{active=false;window.removeEventListener('offline-practice-changed',changed);};
  },[user?.id]);
  return {...(state.pack?.userId===user?.id?state:{attempts:[]}),offline};
}
