import { useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-origin';
import { studentSortOptions, type StudentActivityMetrics, type StudentSortDirection, type StudentSortKey } from '@/lib/student-activity-sorting';

export function useStudentActivity() {
  return useQuery<{ students: StudentActivityMetrics[]; unavailableSources: string[] }>({
    queryKey: ['admin-student-activity'],
    queryFn: async () => {
      const response = await fetch(buildApiUrl('/api/users/student-activity'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load student activity');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function StudentActivitySort({ sortKey, direction, onSortKey, onDirection, loading, unavailable }: {
  sortKey: StudentSortKey; direction: StudentSortDirection;
  onSortKey: (key: StudentSortKey) => void; onDirection: (direction: StudentSortDirection) => void;
  loading: boolean; unavailable: boolean;
}) {
  return <div className="w-full space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="student-sort-key">Sort by</label>
      <select id="student-sort-key" value={sortKey} onChange={event => onSortKey(event.target.value as StudentSortKey)}
        className="h-9 max-w-full rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-student-sort">
        {studentSortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <button type="button" onClick={() => onDirection(direction === 'desc' ? 'asc' : 'desc')}
        aria-label={direction === 'desc' ? 'Descending order. Switch to ascending' : 'Ascending order. Switch to descending'}
        title={direction === 'desc' ? 'Descending · click for ascending' : 'Ascending · click for descending'}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="button-student-sort-direction" data-direction={direction}>
        {direction === 'desc' ? <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" />
          : <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
    <p className="text-[11px] text-muted-foreground" role="status">
      {loading ? 'Loading activity…' : unavailable ? 'Some activity counts are unavailable. Missing counts are shown as —.'
        : 'All-time, across exams. Most Active = QBank attempts + PYQ attempts + submitted tests (including PSU).'}
    </p>
  </div>;
}

export function StudentActivityCounts({ metrics }: { metrics?: StudentActivityMetrics }) {
  return <p className="mt-1 text-[11px] text-muted-foreground" data-testid="student-activity-counts">
    QBank {metrics?.questionBankAttempts ?? '—'} · PYQ {metrics?.pyqAttempts ?? '—'} · Tests {metrics?.testCount ?? '—'}
  </p>;
}
