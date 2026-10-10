import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {RotateCcw} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {buildApiUrl} from '@/lib/api-origin';
import {useToast} from '@/hooks/use-toast';
type AttemptedTest={source:'regular'|'psu';testId:number;psuId:number|null;title:string;attemptCount:number;latestAttemptId:number;submittedAt:string|null;percentage:number};
type Result={items:AttemptedTest[];total:number;hasMore:boolean;psuUnavailable:boolean};
export function StudentTestResetDialog({student,onClose}:{student:{id:number;name:string}|null;onClose:()=>void}) {
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[confirm,setConfirm]=useState<AttemptedTest|null>(null);
  const queryClient=useQueryClient(),{toast}=useToast();
  useEffect(()=>{setSearch('');setPage(0);setConfirm(null);},[student?.id]);
  const query=useQuery<Result>({queryKey:['admin-student-attempted-tests',student?.id,page,search],enabled:!!student,
    queryFn:async()=>{
      const response=await fetch(buildApiUrl(`/api/users/${student!.id}/attempted-tests?limit=30&offset=${page*30}&search=${encodeURIComponent(search)}`),{credentials:'include',cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error??'Could not load attempted tests');return data;
    }});
  const mutation=useMutation({mutationFn:async(test:AttemptedTest)=>{
    const response=await fetch(buildApiUrl(`/api/users/${student!.id}/test-attempts/reset`),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source:test.source,testId:test.testId,latestAttemptId:test.latestAttemptId})});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error??'Could not reset this test'),{status:response.status});return data;
  },onSuccess:async()=>{
    setConfirm(null);setPage(0);
    await queryClient.invalidateQueries({predicate:query=>typeof query.queryKey[0]==='string'&&/student-insights|student-activity|student-attempted-tests|tests|analysis|review-bucket|dashboard/.test(query.queryKey[0])});
    toast({title:'Test reset',description:'This student can attempt it again. Its questions are removed from their bucket. Test content is unchanged.'});
  },onError:(error:Error&{status?:number})=>{if(error.status===409)setConfirm(null);void query.refetch();toast({title:'Reset not completed',description:error.message,variant:'destructive'});}});
  return <Dialog open={!!student} onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}}>
    <DialogContent className="max-w-2xl" hideClose={mutation.isPending}>
      <DialogHeader><DialogTitle>{confirm?'Confirm test reset':'Reset attempted test'}</DialogTitle>
        <DialogDescription>{student?.name} · Only this student's selected test is affected.</DialogDescription></DialogHeader>
      {confirm?<div className="space-y-4">
        <div className="rounded-xl border p-4"><p className="font-semibold">{confirm.title}</p><p className="mt-1 text-sm text-muted-foreground">{confirm.attemptCount} completed attempt{confirm.attemptCount===1?'':'s'} will be cleared.</p></div>
        <p className="text-sm">Their answers, result and test timings will reset, and this test's questions will leave their bucket. They can attempt it again. Other students, other tests and the original test questions will not change.</p>
        <p className="text-xs text-muted-foreground">A private recovery archive is kept before clearing attempts.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={()=>setConfirm(null)}>Cancel</Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={()=>mutation.mutate(confirm)} data-testid="button-confirm-test-reset"><RotateCcw className="mr-2 h-4 w-4"/>{mutation.isPending?'Resetting…':'Reset this test'}</Button></div>
      </div>:<div className="space-y-3">
        <Input aria-label="Search attempted tests" placeholder="Search attempted tests…" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}}/>
        {query.data?.psuUnavailable?<p className="text-sm text-amber-600" role="status">PSU test history is temporarily unavailable. Regular tests are shown below.</p>:null}
        {query.isLoading?<p className="py-8 text-center text-muted-foreground">Loading attempted tests…</p>:query.isError?<p className="text-sm text-destructive" role="alert">{query.error.message}</p>:!query.data?.items.length?<p className="py-8 text-center text-muted-foreground">No attempted tests found.</p>:
          <div className="max-h-[55dvh] space-y-2 overflow-y-auto">{query.data.items.map(test=><div key={`${test.source}:${test.testId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{test.title}</p><p className="mt-1 text-xs text-muted-foreground">{test.source==='psu'?'PSU · ':''}{test.attemptCount} attempt{test.attemptCount===1?'':'s'} · Latest {Math.round(test.percentage)}%{test.submittedAt?` · ${new Date(test.submittedAt).toLocaleDateString()}`:''}</p></div>
            <Button size="sm" variant="outline" onClick={()=>setConfirm(test)} data-testid={`button-reset-test-${test.source}-${test.testId}`}><RotateCcw className="mr-1.5 h-3.5 w-3.5"/>Reset</Button>
          </div>)}</div>}
        <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{query.data?.total??0} attempted tests</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page===0||query.isFetching} onClick={()=>setPage(page-1)}>Previous</Button><Button size="sm" variant="outline" disabled={!query.data?.hasMore||query.isFetching} onClick={()=>setPage(page+1)}>Next</Button></div></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
