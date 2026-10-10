export type StudentSortKey = 'activity' | 'pyq' | 'question-bank' | 'tests' | 'name' | 'newest';
export type StudentSortDirection = 'asc' | 'desc';
export interface StudentActivityMetrics {
  studentId: number;
  activityCount: number | null;
  pyqAttempts: number | null;
  questionBankAttempts: number | null;
  testCount: number | null;
}
export const studentSortOptions: { key: StudentSortKey; label: string }[] = [
  { key: 'activity', label: 'Most Active' }, { key: 'pyq', label: 'PYQ Attempts' },
  { key: 'question-bank', label: 'QBank Attempts' }, { key: 'tests', label: 'Tests Submitted' },
  { key: 'name', label: 'Name' }, { key: 'newest', label: 'Joined Date' },
];

export function sortStudents<T extends { id: number; createdAt: string }>(students: T[], key: StudentSortKey,
  direction: StudentSortDirection, metrics: Map<number, StudentActivityMetrics>, name: (student: T) => string) {
  const value = (student: T): number | string | null => {
    if (key === 'name') return name(student);
    if (key === 'newest') return Date.parse(student.createdAt) || 0;
    const activity = metrics.get(student.id);
    return (key === 'pyq' ? activity?.pyqAttempts : key === 'question-bank' ? activity?.questionBankAttempts
      : key === 'tests' ? activity?.testCount : activity?.activityCount) ?? null;
  };
  return [...students].sort((a, b) => {
    const left = value(a), right = value(b);
    // Unknown/unavailable metrics stay at the end in either direction, never become zero.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const comparison = typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
      : typeof left === 'number' && typeof right === 'number' ? left - right : 0;
    return (direction === 'asc' ? comparison : -comparison)
      || name(a).localeCompare(name(b), undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id;
  });
}
