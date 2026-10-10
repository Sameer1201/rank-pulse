import { RichQuestionContent } from '@/components/ui/rich-question-content';

export interface QueueReport {
  id: number;
  questionId: number;
  questionText: string;
  examKey?: string | null;
  chapterId?: number | null;
  subjectTitle?: string;
  chapterTitle?: string;
  status: string;
  reporterName: string;
  reason: string | null;
}

export function groupOpenQuestionReports<T extends QueueReport>(reports: T[]) {
  const groups = new Map<number, { question: T; reports: T[] }>();
  for (const report of reports) {
    if (report.status.toLowerCase() !== 'open') continue;
    const group = groups.get(report.questionId) ?? { question: report, reports: [] };
    if (!group.reports.some(item => item.id === report.id)) group.reports.push(report);
    groups.set(report.questionId, group);
  }
  return [...groups.values()];
}

export function ReportedQuestionQueue<T extends QueueReport>({ reports, selectedId, onSelect, loading, failed, onRetry, compact = false }: {
  reports: T[]; selectedId: number | null; onSelect: (report: T) => void;
  loading: boolean; failed: boolean; onRetry: () => void; compact?: boolean;
}) {
  const groups = groupOpenQuestionReports(reports);
  return <section aria-label="All reported questions" className="min-w-0 space-y-3">
    <div>
      <h2 className="text-base font-bold text-foreground">Reported questions ({groups.length}{loading ? '+' : ''})</h2>
      <p className="text-xs text-muted-foreground">All chapters · Open reports only</p>
    </div>
    {groups.map(({ question, reports: issues }) => <article key={question.questionId}
      className={`min-w-0 rounded-xl border bg-card p-3 text-card-foreground ${question.questionId === selectedId ? 'border-orange-500 ring-1 ring-orange-500' : 'border-border'}`}>
      <p className="mb-2 text-xs text-muted-foreground">
        {[question.examKey, question.subjectTitle, question.chapterTitle || `Chapter ${question.chapterId}`].filter(Boolean).join(' · ')}
      </p>
      <RichQuestionContent content={question.questionText} className={`break-words text-sm leading-6 ${compact ? 'line-clamp-3' : ''}`} />
      <div className="mt-2 space-y-1">
        {issues.map(issue => <p key={issue.id} className="break-words text-xs text-muted-foreground">
          {issue.reporterName}{issue.reason ? `: ${issue.reason}` : ''}
        </p>)}
      </div>
      <button type="button" onClick={() => onSelect(question)} aria-current={question.questionId === selectedId ? 'true' : undefined}
        className="mt-3 rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-500/10">
        {question.questionId === selectedId ? 'Editing this question' : 'Open & edit'}
      </button>
    </article>)}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading remaining reported questions…</p>}
    {failed && <button type="button" onClick={onRetry} className="text-sm text-destructive underline">Could not load all reports. Retry</button>}
    {!loading && !failed && groups.length === 0 && <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Report queue clear. No open reported questions.</p>}
  </section>;
}
