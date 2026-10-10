import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Eye, Sigma, Timer, XCircle, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip as MetricTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { activityCurvePoints } from '@/lib/weekly-activity-curve';

type Metric = 'correct' | 'wrong' | 'unanswered' | 'minutes' | 'total';
type ActivityDay = { date: string; available: boolean; partial: boolean; correct: number | null; wrong: number | null; unanswered: number | null; seconds: number | null; ungraded: number | null };
export type WeeklyActivity = { start: string; end: string; today: string; currentWeek: string; trackingStartedAt: string; firstAvailableWeek: string | null; lastAvailableWeek: string | null; days: ActivityDay[] };
const metrics: { key: Metric; label: string; color: string; icon: LucideIcon; dash?: string }[] = [
  { key: 'correct', label: 'Correct', color: '#10b981', icon: CheckCircle2 },
  { key: 'wrong', label: 'Wrong', color: '#f43f5e', icon: XCircle, dash: '6 3' },
  { key: 'unanswered', label: 'Visited, not answered', color: '#eaa008', icon: Eye, dash: '2 3' },
  { key: 'minutes', label: 'Time spent', color: '#8b5cf6', icon: Timer, dash: '8 3 2 3' },
  { key: 'total', label: 'Total answered', color: '#3b82f6', icon: Sigma },
];
export function shiftActivityDay(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function currentActivityWeek(now = Date.now()) {
  const date = new Date(now + 330 * 60000);
  return shiftActivityDay(date.toISOString().slice(0, 10), -6);
}
function dayLabel(date: string, weekday = false) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...(weekday ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) });
}
export function activityDuration(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  return rounded >= 3600 ? `${Math.floor(rounded / 3600)}h ${Math.floor(rounded % 3600 / 60)}m`
    : rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`;
}

export default function WeeklyActivityChart({ studentId }: { studentId: number }) {
  const [currentWeek, setCurrentWeek] = useState(() => currentActivityWeek());
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<Metric, boolean>>({ correct: false, wrong: false, unanswered: false, minutes: false, total: true });
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentWeek(currentActivityWeek()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const requestedStart = selectedWeek ?? currentWeek;
  const query = useQuery<WeeklyActivity>({
    queryKey: ['student-weekly-activity', 'rolling', studentId, requestedStart],
    queryFn: () => api.get(`/student/activity/week?start=${requestedStart}`),
    staleTime: 30000, refetchOnWindowFocus: true, refetchOnMount: 'always',
    refetchInterval: requestedStart === currentWeek ? 60000 : false,
  });
  const start = query.data?.start ?? requestedStart;
  const firstWeek = query.data?.firstAvailableWeek;
  const lastWeek = query.data?.lastAvailableWeek;
  const days = query.data?.days ?? [];
  // A missing or upcoming day is not a zero. Only recorded daily totals can
  // become plot points; smoothing must never create additional activity data.
  const dailyPoints = days.map(day => {
    const recorded = day.available && day.date <= (query.data?.today ?? '');
    return { ...day, day: dayLabel(day.date, true),
      correct: recorded ? day.correct : null, wrong: recorded ? day.wrong : null,
      unanswered: recorded ? day.unanswered : null,
      total: recorded && day.correct !== null && day.wrong !== null && day.ungraded !== null ? day.correct + day.wrong + day.ungraded : null,
      minutes: recorded && day.seconds !== null ? day.seconds / 60 : null };
  });
  const points = activityCurvePoints(dailyPoints);
  const dayTicks = days.map(day => Date.parse(`${day.date}T00:00:00Z`));
  const active = metrics.filter(metric => selected[metric.key]);
  const recordedDays = days.filter(day => day.available && day.date <= (query.data?.today ?? ''));
  const hasAvailable = recordedDays.length > 0;
  const sum = (key: 'correct' | 'wrong' | 'unanswered' | 'seconds' | 'ungraded') => recordedDays.reduce((total, day) => total + (day[key] ?? 0), 0);
  const totalAnswered = sum('correct') + sum('wrong') + sum('ungraded');
  const partial = days.some(day => !day.available && day.date <= (query.data?.today ?? '')) || days.some(day => day.partial);
  const axisStyle = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
  return <Card className="min-w-0 border-border/60 shadow-sm">
    <CardHeader className="gap-2 space-y-0 p-4 pb-2 sm:flex-row sm:items-start sm:justify-between sm:p-4 sm:pb-2">
      <CardTitle className="text-sm">Weekly practice activity</CardTitle>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="icon" variant="outline" className="h-7 w-7 rounded-lg" aria-label="Previous 7 days" disabled={query.isFetching || !firstWeek || start <= firstWeek} onClick={() => setSelectedWeek(shiftActivityDay(start, -7))}><ChevronLeft className="h-3.5 w-3.5" /></Button>
        <span className="text-[11px] font-medium tabular-nums" aria-live="polite">{dayLabel(start)} – {dayLabel(shiftActivityDay(start, 6))}</span>
        <Button size="icon" variant="outline" className="h-7 w-7 rounded-lg" aria-label="Next 7 days" disabled={query.isFetching || !lastWeek || start >= lastWeek} onClick={() => setSelectedWeek(shiftActivityDay(start, 7))}><ChevronRight className="h-3.5 w-3.5" /></Button>
        {lastWeek && start !== lastWeek && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelectedWeek(null)}>Last 7 days</Button>}
      </div>
    </CardHeader>
    <CardContent className="space-y-3 p-4 pt-0 sm:p-4 sm:pt-0">
      <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <legend className="sr-only">Choose chart parameters</legend>
        {metrics.map(({ icon: Icon, ...metric }) => <MetricTooltip key={metric.key} delayDuration={0}><TooltipTrigger asChild><label className="relative flex min-h-8 cursor-pointer items-center gap-1.5 py-1">
          <input type="checkbox" aria-label={metric.label} className="peer sr-only" checked={selected[metric.key]} onChange={event => setSelected(old => ({ ...old, [metric.key]: event.target.checked }))} />
          <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-2 text-white transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background" style={{ borderColor: metric.color, backgroundColor: selected[metric.key] ? metric.color : 'transparent' }}>
            {selected[metric.key] && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: metric.color }} />
          <span className="text-xs font-semibold tabular-nums text-foreground">{query.isError || !hasAvailable ? '—' : metric.key === 'minutes' ? activityDuration(sum('seconds')) : metric.key === 'total' ? totalAnswered : sum(metric.key)}</span>
        </label></TooltipTrigger><TooltipContent side="top" className="weekly-metric-tooltip pointer-events-none border border-border bg-popover text-popover-foreground shadow-md">{metric.label}</TooltipContent></MetricTooltip>)}
      </fieldset>
      </TooltipProvider>
      {query.isPending ? <div role="status" className="py-10 text-center text-xs text-muted-foreground">Loading weekly activity…</div>
        : query.isError ? <div role="alert" className="py-12 text-center text-sm"><p>Could not load activity. Your progress has not been reset.</p><Button variant="outline" className="mt-3" onClick={() => query.refetch()}>Retry</Button></div>
        : !hasAvailable ? <p className="py-10 text-center text-xs text-muted-foreground">Daily history unavailable for this range.</p>
        : active.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">Select at least one parameter to display the chart.</p>
        : <div className="h-[180px] min-w-0 w-full sm:h-[200px]" aria-label="Daily activity line chart">
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{active.some(m => m.key !== 'minutes') ? 'Questions' : ''}</span><span>{selected.minutes ? 'Minutes' : ''}</span></div>
          <ResponsiveContainer width="100%" height="94%">
            <LineChart data={points} margin={{ top: 8, right: 12, left: -16, bottom: 4 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="timestamp" type="number" domain={[dayTicks[0], dayTicks[dayTicks.length - 1]]} ticks={dayTicks} tickFormatter={value => dayLabel(new Date(value).toISOString().slice(0, 10), true)} axisLine={false} tickLine={false} tick={axisStyle} interval={0} />
              <YAxis yAxisId="questions" hide={!active.some(m => m.key !== 'minutes')} allowDecimals={false} axisLine={false} tickLine={false} tick={axisStyle} width={44} domain={[0, 'auto']} />
              <YAxis yAxisId="time" orientation="right" hide={!selected.minutes} axisLine={false} tickLine={false} tick={axisStyle} width={42} domain={[0, 'auto']} />
              <Tooltip content={({ active: hovering, payload }) => {
                const point = payload?.[0]?.payload as typeof points[number] | undefined;
                if (!hovering || !point) return null;
                return <div className="rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
                  <p className="mb-2 font-semibold">{dayLabel(point.date)}{point.estimated ? ` · +${(point.timestamp - Date.parse(`${point.date}T00:00:00Z`)) / 3600000}h · Estimated` : point.partial ? ' · Partial day' : ''}</p>
                  {active.map(metric => <p key={metric.key} className="flex justify-between gap-6 py-0.5"><span>{metric.label}</span><strong>{point.estimated ? '≈ ' : ''}{metric.key === 'minutes' ? activityDuration(point.estimated ? (point.minutes ?? 0) * 60 : point.seconds ?? 0) : point[metric.key]?.toLocaleString('en-GB', { maximumFractionDigits: 2 })}</strong></p>)}
                </div>;
              }} />
              {active.map(metric => <Line key={metric.key} type="monotoneX" dataKey={metric.key} yAxisId={metric.key === 'minutes' ? 'time' : 'questions'} name={metric.label} stroke={metric.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={metric.dash} dot={({ cx, cy, payload, value }) => !payload.estimated && value != null ? <circle key={payload.timestamp} className="recharts-line-dot" cx={cx} cy={cy} r={2} stroke={metric.color} fill="hsl(var(--background))"/> : <g key={payload.timestamp}/>} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>}
      {!query.isError && query.data && <>
        {partial || !hasAvailable ? <p className="text-xs text-muted-foreground" title={`Tracking started ${new Date(query.data.trackingStartedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`}>Partial history</p> : null}
        {sum('ungraded') > 0 && <p className="text-xs text-muted-foreground">{sum('ungraded')} ungraded answers</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Daily breakdown</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{days.map(day => <div key={day.date} className="rounded-lg border border-border p-3"><p className="mb-2 font-semibold text-foreground">{dayLabel(day.date)}{day.partial ? ' · Partial' : ''}</p>
            {!day.available ? <p>{day.date > query.data!.today ? 'Upcoming' : 'History unavailable'}</p> : active.map(metric => <p key={metric.key} className="flex justify-between gap-2 py-0.5"><span>{metric.label}</span><span className="font-medium text-foreground">{metric.key === 'minutes' ? activityDuration(day.seconds ?? 0) : metric.key === 'total' ? (day.correct ?? 0) + (day.wrong ?? 0) + (day.ungraded ?? 0) : day[metric.key]}</span></p>)}
          </div>)}</div>
        </details>
      </>}
    </CardContent>
  </Card>;
}
