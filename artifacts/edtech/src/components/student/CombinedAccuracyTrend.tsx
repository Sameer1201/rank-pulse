import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { readStudentDashboard } from '../../../../api-server/src/lib/studentDashboard';

type History = Awaited<ReturnType<typeof readStudentDashboard>>['history'];

// Trim only the outside dates. Removing interior gaps would join unrelated days.
export function boundedAccuracyHistory(history: History): History {
  const rows = history.map(row => ({
    ...row,
    accuracy: row.available && row.accuracy !== null && Number.isFinite(row.accuracy)
      && row.accuracy >= 0 && row.accuracy <= 100 ? row.accuracy : null,
  }));
  const first = rows.findIndex(row => row.accuracy !== null);
  if (first === -1) return [];
  let last = rows.length - 1;
  while (rows[last].accuracy === null) last--;
  return rows.slice(first, last + 1);
}

const formatDate = (date: string, includeYear = false) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' } : {}),
});

export default function CombinedAccuracyTrend({ history: savedHistory }: { history: History }) {
  const history = boundedAccuracyHistory(savedHistory);
  const first = history[0]?.date, last = history[history.length - 1]?.date;
  const range = first && last ? first === last ? formatDate(first, true) : `${formatDate(first, true)} – ${formatDate(last, true)}` : null;
  return <Card aria-label="Combined accuracy trend">
    <CardHeader>
      <CardTitle>Combined accuracy trend</CardTitle>
      {range && <CardDescription>{range} · IST</CardDescription>}
    </CardHeader>
    <CardContent>
      {history.length > 0 ? <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ left: -20, right: 8, top: 10, bottom: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
            <XAxis dataKey="date" tickFormatter={date => formatDate(date)} minTickGap={30} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}/>
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={value => `${value}%`}/>
            <Tooltip labelFormatter={date => `${formatDate(String(date), true)} · IST`} contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} formatter={(value: number) => [`${value}%`, 'Accuracy']}/>
            <Line dataKey="accuracy" name="Accuracy" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      </div> : <p className="py-12 text-center text-sm text-muted-foreground">No daily accuracy data yet.</p>}
    </CardContent>
  </Card>;
}
