import {useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {buildApiUrl} from '@/lib/api-origin';
import {applyTestAttemptReset,readTestResetCursor,type TestAttemptReset} from '@/lib/test-attempt-resets';
export function useTestAttemptResets(studentId:number|null) {
  const queryClient=useQueryClient();
  const memoryStorage=useRef(new Map<string,string>());
  useQuery({queryKey:['student-test-reset-events',studentId],enabled:!!studentId,staleTime:15000,refetchInterval:30000,retry:1,
    queryFn:async()=>{
      let storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
      try{storage=window.localStorage;storage.getItem('rankpulse-test-reset-storage-check');}
      catch{storage={getItem:key=>memoryStorage.current.get(key)??null,setItem:(key,value)=>{memoryStorage.current.set(key,value);},removeItem:key=>{memoryStorage.current.delete(key);}};}
      let cursor=readTestResetCursor(storage,studentId!),more=true;
      const applied:TestAttemptReset[]=[];
      for(let page=0;more&&page<25;page++) {
        const response=await fetch(buildApiUrl(`/api/users/me/test-attempt-resets?since=${cursor.resetAt}&afterId=${encodeURIComponent(cursor.id)}`),{credentials:'include',cache:'no-store'});
        if(!response.ok)throw Error('Could not check test resets');
        const data=await response.json() as {items:TestAttemptReset[];hasMore:boolean;nextCursor:{resetAt:number;id:string}|null};
        for(const reset of data.items)if(applyTestAttemptReset(storage,studentId!,reset))applied.push(reset);
        more=data.hasMore;
        if(!data.nextCursor)break;
        cursor=data.nextCursor;
      }
      if(applied.length) {
        window.dispatchEvent(new CustomEvent('student-test-attempt-reset',{detail:applied}));
        await queryClient.invalidateQueries({predicate:query=>typeof query.queryKey[0]==='string'
          && /student-tests|student-test-preview|student-test-card|student-psu-test|review-bucket|student-analysis|dashboard|psu-test|psu-student|^psu$/.test(query.queryKey[0])});
      }
      return true;
    }});
}
