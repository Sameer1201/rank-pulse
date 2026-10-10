import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FlaskConical } from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";
import {
  ADMIN_EXAM_STORAGE_KEY,
  adminExamPath,
  persistAdminExam,
  readAdminExamQuery,
} from "@/lib/admin-exam-selection";

export interface AdminExamOption {
  key: string;
  label: string;
  description?: string | null;
  questionBankAvailable?: boolean;
  pyqAvailable?: boolean;
}

export default function AdminExamSelector() {
  const [location, setLocation] = useLocation();
  const [storedExam, setStoredExam] = useState(() => {
    try { return localStorage.getItem(ADMIN_EXAM_STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const { data: exams = [], isLoading } = useQuery<AdminExamOption[]>({
    queryKey: ["admin-exams"],
    queryFn: async () => {
      // The auth exam catalog is available in both the Express and the
      // Cloudflare API runtimes, so the selector stays in sync in production.
      const response = await fetch(buildApiUrl("/api/auth/exams"), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load exams");
      const rows = await response.json() as Array<{ exam: string; label: string; description?: string | null }>;
      return rows.map((row) => ({ key: row.exam, label: row.label, description: row.description }));
    },
    staleTime: 60_000,
  });

  const queryExam = readAdminExamQuery(location);
  const selectedExam = useMemo(() => {
    const requested = queryExam || storedExam;
    return exams.some((exam) => exam.key === requested) ? requested : exams[0]?.key ?? "";
  }, [exams, queryExam, storedExam]);

  useEffect(() => {
    if (!selectedExam) return;
    setStoredExam(selectedExam);
    persistAdminExam(selectedExam);
  }, [selectedExam]);

  // Keep a direct visit to the admin workspace aligned with the selector's
  // persisted choice. Without this, the header could say JAM Chemistry while
  // the page fell back to its first card (usually GATE EC).
  useEffect(() => {
    const pathname = adminExamPath(location);
    if (!selectedExam || queryExam || (pathname !== "/admin/question-bank" && pathname !== "/admin/pyq")) return;
    setLocation(`${pathname}?exam=${encodeURIComponent(selectedExam)}`);
  }, [location, queryExam, selectedExam, setLocation]);

  if (isLoading || exams.length === 0) return null;

  function selectExam(nextExam: string) {
    setStoredExam(nextExam);
    persistAdminExam(nextExam);
    const pathname = adminExamPath(location);
    if (pathname.startsWith("/admin/question-bank")) {
      setLocation(`/admin/question-bank?exam=${encodeURIComponent(nextExam)}`);
    } else if (pathname.startsWith("/admin/pyq")) {
      setLocation(`/admin/pyq?exam=${encodeURIComponent(nextExam)}`);
    }
  }

  return (
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-orange-800 shadow-sm dark:border-orange-400/30 dark:bg-orange-950/30 dark:text-orange-200">
      <FlaskConical className="h-4 w-4 shrink-0" />
      <span className="hidden text-[10px] font-bold uppercase tracking-wide sm:inline">Exam</span>
      <span className="relative min-w-0">
        <select
          aria-label="Select exam"
          data-testid="admin-exam-selector"
          value={selectedExam}
          onChange={(event) => selectExam(event.target.value)}
          className="max-w-[10rem] appearance-none truncate bg-transparent pr-5 text-xs font-bold outline-none sm:max-w-[13rem]"
        >
          {exams.map((exam) => <option key={exam.key} value={exam.key}>{exam.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
      </span>
    </label>
  );
}
