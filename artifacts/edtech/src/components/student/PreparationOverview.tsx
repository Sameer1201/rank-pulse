import { useEffect, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowUpRight, BookOpen, CheckCircle2, Clock3, Target, Trophy } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import WeeklyActivityChart, { activityDuration } from './WeeklyActivityChart';
import CombinedAccuracyTrend from './CombinedAccuracyTrend';
import type { readStudentDashboard } from '../../../../api-server/src/lib/studentDashboard';

export type PreparationData = Awaited<ReturnType<typeof readStudentDashboard>>;
type GoalProps = { attempted: number; syncState?: 'loading'|'error'; onRetry?:()=>void; streak:number; goal:number; isEditing:boolean; draftGoal:string; onDraftChange:(value:string)=>void; onEdit:()=>void; onCancel:()=>void; onSave:()=>void; isSaving:boolean };
const sourcePaths = { tests:'/student/tests', 'question-bank':'/student/question-bank', pyq:'/student/pyq', psu:'/student/psu' };
const sourceColors = { tests:'#8b5cf6', 'question-bank':'#f97316', pyq:'#10b981', psu:'#3b82f6' };
const sourceLabels = { tests:'Tests', 'question-bank':'Question Bank', pyq:'PYQ', psu:'PSU tests' };
const istDay = () => new Date(Date.now()+330*60000).toISOString().slice(0,10);
const percentage = (value:number|null) => value === null ? '—' : `${value}%`;
const tooltipStyle = {backgroundColor:'hsl(var(--popover))',color:'hsl(var(--popover-foreground))',border:'1px solid hsl(var(--border))',borderRadius:12,fontSize:12};

export default function PreparationOverview({GoalTracker}:{GoalTracker:ComponentType<GoalProps>}) {
  const {user,login}=useAuth(); const {toast}=useToast(); const [,navigate]=useLocation();const client=useQueryClient();
  const savedGoal=Number(user?.profileDetails?.dashboard?.dailyQuestionGoal)||50;
  const [editing,setEditing]=useState(false),[goalDraft,setGoalDraft]=useState(String(savedGoal)),[saving,setSaving]=useState(false);
  const [day,setDay]=useState(istDay);
  useEffect(()=>{const timer=window.setInterval(()=>setDay(istDay()),15000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(!editing)setGoalDraft(String(savedGoal));},[savedGoal,editing]);
  const query=useQuery<PreparationData>({queryKey:['student-preparation-overview',user?.id,day],queryFn:()=>api.get('/student/dashboard/overview'),enabled:!!user,
    staleTime:30000,refetchOnMount:'always',refetchOnWindowFocus:true,refetchOnReconnect:true,refetchInterval:60000});
  const daily=useQuery<{date:string;attemptedToday:number}>({queryKey:['student-daily-activity',user?.id,day],queryFn:()=>api.get('/student/activity/today'),enabled:!!user,
    staleTime:30000,refetchOnMount:'always',refetchOnWindowFocus:true,refetchOnReconnect:true,refetchInterval:60000});
  const saveGoal=async()=>{
    const value=Number(goalDraft);
    if(!Number.isInteger(value)||value<1||value>5000){toast({title:'Enter a daily goal between 1 and 5000',variant:'destructive'});return;}
    setSaving(true);
    try{login(await api.patch('/auth/profile',{dailyQuestionGoal:value}));await client.invalidateQueries({queryKey:['auth','me']});setEditing(false);toast({title:'Daily goal updated'});}
    catch(error){toast({title:'Could not save goal',description:error instanceof Error?error.message:'Please retry',variant:'destructive'});}finally{setSaving(false);}
  };
  const data=query.data;
  if(!data&&query.isPending)return <div role="status" className="space-y-5"><p className="text-sm text-muted-foreground">Loading your Tests, Question Bank, PYQ and PSU progress…</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map(i=><div key={i} className="h-36 animate-pulse rounded-2xl bg-muted"/>)}</div></div>;
  if(!data)return <Card><CardHeader><CardTitle>Preparation overview unavailable</CardTitle><CardDescription>Your saved progress has not been reset.</CardDescription></CardHeader><CardContent><Button onClick={()=>query.refetch()}>Retry</Button></CardContent></Card>;
  const refreshed=new Date(data.generatedAt).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
  const missing=(key:string)=>data.unavailableSources.includes(key)||(key==='pyq'&&data.unavailableSources.includes('jam-pyq'));
  const metricCards=[
    {label:'Questions practiced',value:data.totals.questions,icon:Target},
    {label:'Overall accuracy',value:percentage(data.totals.accuracy),detail:`${data.totals.correct} correct · ${data.totals.wrong} wrong`,icon:CheckCircle2},
    {label:'Total study time',value:activityDuration(data.totals.seconds),icon:Clock3},
    {label:'Test attempts completed',value:data.totals.completed,icon:Trophy},
  ];
  const subjectData=data.subjects.slice(0,12);
  const insightContentHeight=Math.max(240,subjectData.length*38);
  const visibleSources=data.sources.filter(source=>source.key!=='psu'||source.questions>0||source.completed>0);
  const testAttempts=(data.testAttempts??[]).map((attempt,index)=>({...attempt,label:String(index+1)}));
  return <div className="mx-auto max-w-[1600px] space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-bold sm:text-3xl">Your preparation dashboard</h1>
      <p className="text-right text-[10px] text-muted-foreground">Updated {refreshed} IST</p>
    </div>
    {query.isError&&<p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Refresh failed. Showing your last successful summary.</p>}
    {data.partial&&<p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Some sources could not sync: {data.unavailableSources.join(', ')}. Totals below are partial—not your complete progress. Please retry.</p>}
    <GoalTracker attempted={daily.data?.date===day?daily.data.attemptedToday:0} syncState={daily.isError?'error':daily.data?.date!==day?'loading':undefined} onRetry={()=>{void daily.refetch();}} streak={data.streak} goal={savedGoal} isEditing={editing} draftGoal={goalDraft} onDraftChange={setGoalDraft} onEdit={()=>setEditing(true)} onCancel={()=>setEditing(false)} onSave={()=>{void saveGoal();}} isSaving={saving}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.map(({label,value,detail,icon:Icon})=><Card key={label}><CardHeader className="flex-row items-center justify-between gap-2 pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle><Icon className="h-5 w-5 text-primary"/></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums">{value}</p>{detail&&<p className="mt-2 text-xs text-muted-foreground">{detail}</p>}</CardContent></Card>)}</div>
    <section aria-label="Progress by source" className="space-y-3"><h2 className="text-lg font-semibold">Practice sources</h2><div className={`grid gap-4 sm:grid-cols-2 ${visibleSources.length===3?'xl:grid-cols-3':'xl:grid-cols-4'}`}>{visibleSources.map(source=><Card key={source.key} className="border-t-4" style={{borderTopColor:sourceColors[source.key]}}>
      <CardHeader className="pb-3"><CardTitle className="flex items-center justify-between text-base">{source.label}<BookOpen className="h-4 w-4 text-muted-foreground"/></CardTitle></CardHeader>
      <CardContent className="space-y-3">{missing(source.key)?<p className="text-sm text-amber-600 dark:text-amber-300">Source sync incomplete</p>:<><p className="text-2xl font-bold">{source.questions}<span className="ml-2 text-xs font-normal text-muted-foreground">questions</span></p><div className="flex justify-between text-xs"><span>{source.correct} correct · {source.wrong} wrong</span><strong>{percentage(source.accuracy)}</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{width:`${source.accuracy??0}%`,backgroundColor:sourceColors[source.key]}}/></div></>}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5"/>{data.unavailableSources.includes('timers')&&(source.key==='pyq'||source.key==='question-bank')?'Time unavailable':activityDuration(source.seconds)}</p>
        <Button variant="outline" size="sm" className="w-full" onClick={()=>navigate(sourcePaths[source.key])}>Open {source.label}<ArrowUpRight className="ml-2 h-3.5 w-3.5"/></Button>
      </CardContent></Card>)}</div></section>
    {testAttempts.length>0&&<Card aria-label="Test performance graph"><CardHeader><CardTitle>Test performance trend</CardTitle></CardHeader><CardContent>
      <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={testAttempts} margin={{left:-12,right:16,top:12,bottom:8}} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
        <XAxis dataKey="label" minTickGap={20} tick={{fontSize:11,fill:'hsl(var(--muted-foreground))'}}/>
        <YAxis domain={[(min:number)=>Math.min(0,min),(max:number)=>Math.max(100,max)]} tickFormatter={value=>`${value}%`} tick={{fontSize:11,fill:'hsl(var(--muted-foreground))'}}/>
        <Tooltip content={({active,payload})=>{const attempt=payload?.[0]?.payload as typeof testAttempts[number]|undefined;return active&&attempt?<div className="max-w-xs rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"><p className="font-semibold">{attempt.title}</p><p className="mt-1">{sourceLabels[attempt.source]} · {new Date(attempt.at).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})} IST</p><p className="mt-2 font-semibold">{attempt.score} / {attempt.totalPoints} marks · {percentage(attempt.percentage)}</p></div>:null;}}/>
        <Line dataKey="percentage" name="Score" stroke="#8b5cf6" strokeWidth={2.5} dot={{r:4}} activeDot={{r:6}} connectNulls={false} isAnimationActive={false}/>
      </LineChart></ResponsiveContainer></div>
      <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Test scores & analysis</summary><div className="mt-3 space-y-2">{testAttempts.map(attempt=><button key={attempt.id} onClick={()=>navigate(attempt.path)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50"><span className="min-w-0"><span className="block break-words font-medium">{attempt.title}</span><span className="text-xs text-muted-foreground">{sourceLabels[attempt.source]} · {new Date(attempt.at).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})} IST</span></span><span className="shrink-0 tabular-nums">{attempt.score}/{attempt.totalPoints} · {percentage(attempt.percentage)}</span></button>)}</div></details>
    </CardContent></Card>}
    <div className="grid items-stretch gap-6 lg:grid-cols-2">
      <Card className="min-w-0"><CardHeader><CardTitle>Subject-wise accuracy</CardTitle></CardHeader><CardContent>
        {subjectData.length===0?<p className="py-12 text-center text-sm text-muted-foreground">Attempt a question in any practice section to start.</p>:<div className="w-full" style={{height:insightContentHeight}}><ResponsiveContainer width="100%" height="100%"><BarChart data={subjectData} layout="vertical" margin={{left:0,right:24,top:4,bottom:0}}><CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))"/><XAxis type="number" domain={[0,100]} tickFormatter={value=>`${value}%`} tick={{fontSize:10,fill:'hsl(var(--muted-foreground))'}}/><YAxis type="category" dataKey="subject" width={105} tickFormatter={value=>String(value).length>16?`${String(value).slice(0,15)}…`:value} tick={{fontSize:11,fill:'hsl(var(--foreground))'}}/><Tooltip contentStyle={tooltipStyle} cursor={{fill:'hsl(var(--muted))'}} formatter={(value:number)=>[`${value}%`,'Accuracy']}/><Bar dataKey="accuracy" fill="#f97316" radius={[0,5,5,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div>}
      </CardContent></Card>
      <Card className="flex min-h-0 min-w-0 flex-col"><CardHeader className="shrink-0"><CardTitle id="focus-next-title">Where to focus next</CardTitle></CardHeader><CardContent className="min-h-0 flex-1">
        <div role="region" aria-labelledby="focus-next-title" tabIndex={0} className="space-y-2 overflow-y-auto overscroll-contain rounded-lg pr-2 [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{maxHeight:insightContentHeight}}>
        {data.weakAreas.length===0?<p className="py-12 text-center text-sm text-muted-foreground">{data.totals.questions?'No incorrect graded answers.':'No practice data yet.'}</p>:data.weakAreas.map((area,index)=><button key={`${area.subject}:${area.topic}`} className="flex w-full items-start justify-between gap-3 rounded-xl border border-border p-3 text-left transition hover:bg-muted/50" onClick={()=>navigate(area.path)}><div className="min-w-0"><p className="break-words text-sm font-semibold">{index+1}. {area.topic}</p><p className="mt-1 text-xs text-muted-foreground">{area.subject} · {area.questions} questions</p></div><span className="shrink-0 text-sm font-semibold text-rose-600 dark:text-rose-400">{percentage(area.accuracy)}</span></button>)}
        </div>
      </CardContent></Card>
    </div>
    <CombinedAccuracyTrend history={data.history}/>
    <Card><CardHeader><CardTitle>Recent practice across all sources</CardTitle></CardHeader><CardContent>
      {data.recent.length===0?<p className="py-8 text-center text-sm text-muted-foreground">No saved practice yet. Start with PYQ, Q Bank or a test.</p>:<div className="grid gap-3 md:grid-cols-2">{data.recent.map(row=><button key={`${row.source}:${row.subject}:${row.title}`} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-border p-3 text-left transition hover:bg-muted/50" onClick={()=>navigate(row.path)}><div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-wider" style={{color:sourceColors[row.source]}}>{sourceLabels[row.source]}</span><p className="mt-1 break-words text-sm font-semibold">{row.title}</p><p className="mt-1 text-xs text-muted-foreground">{row.subject} · {row.questions} questions</p><p className="mt-1 text-xs text-muted-foreground">{row.at?new Date(row.at).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'Date unavailable'}</p></div><ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"/></button>)}</div>}
    </CardContent></Card>
    {user&&<WeeklyActivityChart studentId={user.id}/>}
    {data.totals.ungraded>0&&<p className="text-xs text-muted-foreground">{data.totals.ungraded} ungraded answers</p>}
  </div>;
}
