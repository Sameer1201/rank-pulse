import { useState } from "react";
import { BookmarkCheck, BookOpen, CheckCircle, ChevronRight, Clock, Lock, Target } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import PendingVerificationDialog from "@/components/student/PendingVerificationDialog";
import StudentPreviewLockBanner from "@/components/student/StudentPreviewLockBanner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { isStudentFeatureLocked, isStudentPendingVerification } from "@/lib/student-access";
import { applyPendingPreviewLocksToExamSummaries, useStudentQuestionBankExams, useStudentSavedQuestionCount } from "@/pages/student/question-bank/api";

type QuestionBankProgressSummary = {
  totalSolvedQuestions: number;
  totalAttemptedQuestions?: number;
};

function PendingQuestionBankPreview() {
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: exams = [], isLoading } = useStudentQuestionBankExams();
  const previewExams = applyPendingPreviewLocksToExamSummaries(exams);
  const totalExams = previewExams.length;
  const totalQuestions = previewExams.reduce((sum, exam) => sum + exam.questionCount, 0);
  const totalChapters = previewExams.reduce((sum, exam) => sum + exam.chapterCount, 0);
  const attemptedQuestions = previewExams.reduce((sum, exam) => sum + (exam.attemptedQuestionCount ?? 0), 0);

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Question Banks</h1>
        </div>

        <StudentPreviewLockBanner
          title="Question bank preview locked"
          description="Preview only for now. Full question bank unlocks after approval."
          onCheckStatus={() => setLocation("/student/pending-approval")}
          onOpenLocked={() => setDialogOpen(true)}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active Exams" value={totalExams} icon={<BookOpen className="h-4 w-4" />} color="text-primary" bg="bg-primary/10" />
          <StatCard label="Total Questions" value={totalQuestions} icon={<Target className="h-4 w-4" />} color="text-amber-600" bg="bg-amber-50" />
          <StatCard label="Attempted" value={attemptedQuestions} icon={<CheckCircle className="h-4 w-4" />} color="text-emerald-600" bg="bg-emerald-50" />
          <StatCard label="Chapters" value={totalChapters} icon={<Clock className="h-4 w-4" />} color="text-violet-600" bg="bg-violet-50" />
        </div>

        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">Available Exam Question Banks</h2>
          {isLoading ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
              Loading question banks...
            </div>
          ) : previewExams.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
              No question bank preview is available yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {previewExams.map((exam) => {
                const attempted = exam.attemptedQuestionCount ?? 0;
                const pct = exam.questionCount > 0 ? Math.round((attempted / exam.questionCount) * 100) : 0;
                const isLocked = Boolean(exam.isLocked);

                return (
                  <button
                    key={exam.key}
                    type="button"
                    onClick={() => {
                      if (isLocked) {
                        setDialogOpen(true);
                        return;
                      }
                      setLocation(`/student/question-bank/exam/${exam.key}`);
                    }}
                    className="group cursor-pointer rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="chip-orange-soft inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold">
                            {exam.label}
                          </span>
                          <span className="chip-orange-solid rounded-full px-2 py-0.5 text-xs font-medium">
                            {isLocked ? "Locked" : "Preview"}
                          </span>
                        </div>
                        <h3 className="mt-2 text-sm font-semibold leading-tight text-foreground">{exam.label}</h3>
                      </div>
                      {isLocked ? (
                        <Lock className="h-4 w-4 text-amber-600" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      )}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.subjectCount}</div>
                        <div className="text-[10px] text-muted-foreground">Subjects</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.chapterCount}</div>
                        <div className="text-[10px] text-muted-foreground">Chapters</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.questionCount}</div>
                        <div className="text-[10px] text-muted-foreground">Questions</div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{attempted}/{exam.questionCount} attempted</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PendingVerificationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCheckStatus={() => setLocation("/student/pending-approval")}
      />
    </>
  );
}

function ApprovedQuestionBankDashboard({ enabled = true, featureLocked = false }: { enabled?: boolean; featureLocked?: boolean }) {
  const { data: exams = [], isLoading } = useStudentQuestionBankExams(enabled);
  const { data: savedQuestionCount } = useStudentSavedQuestionCount(enabled && !featureLocked);
  const { data: progress } = useQuery<QuestionBankProgressSummary>({
    queryKey: ["dashboard-question-bank-progress"],
    queryFn: () => api.get("/question-bank/progress/summary"),
    enabled: enabled && !featureLocked,
    staleTime: 30_000,
  });
  const totalExams = exams.length;
  const totalQuestions = exams.reduce((sum, exam) => sum + exam.questionCount, 0);
  const totalChapters = exams.reduce((sum, exam) => sum + exam.chapterCount, 0);
  const attemptedQuestions = progress?.totalAttemptedQuestions ?? progress?.totalSolvedQuestions ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Question Banks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Browse exams, subjects and chapters to practise questions.</p>
        </div>
        <Link
          to="/student/question-bank/saved"
          className="group inline-flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-50 hover:shadow-md"
          data-testid="link-saved-questions"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 transition group-hover:scale-105">
            <BookmarkCheck className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-amber-900">Saved Questions</span>
            <span className="block text-xs text-amber-700">
              {savedQuestionCount ? `${savedQuestionCount.count} bookmarked` : "View your bookmarks"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-amber-600 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {featureLocked ? (
        <div className="rounded-[24px] border border-[#F5D0A5] bg-[linear-gradient(135deg,#FFF8ED_0%,#FFFFFF_100%)] px-4 py-4 shadow-[0_10px_26px_rgba(249,115,22,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B45309]">Locked access</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">
            You can browse exams and subjects normally. Payment will be asked only when you try to open a locked chapter.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Exams" value={totalExams} icon={<BookOpen className="h-4 w-4" />} color="text-primary" bg="bg-primary/10" />
        <StatCard label="Total Questions" value={totalQuestions} icon={<Target className="h-4 w-4" />} color="text-amber-600" bg="bg-amber-50" />
        <StatCard label="Attempted" value={attemptedQuestions} icon={<CheckCircle className="h-4 w-4" />} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard label="Chapters" value={totalChapters} icon={<Clock className="h-4 w-4" />} color="text-violet-600" bg="bg-violet-50" />
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">Available Exam Question Banks</h2>
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            Loading question banks...
          </div>
        ) : exams.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            No question bank is available for your exam profile yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {exams.map((exam) => {
              const attempted = exam.attemptedQuestionCount ?? 0;
              const pct = exam.questionCount > 0 ? Math.round((attempted / exam.questionCount) * 100) : 0;

              return (
                <Link key={exam.key} to={`/student/question-bank/exam/${exam.key}`}>
                  <div className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="chip-orange-soft inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold">
                            {exam.label}
                          </span>
                        </div>
                        <h3 className="mt-2 text-sm font-semibold leading-tight text-foreground">{exam.label}</h3>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.subjectCount}</div>
                        <div className="text-[10px] text-muted-foreground">Subjects</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.chapterCount}</div>
                        <div className="text-[10px] text-muted-foreground">Chapters</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-foreground sm:text-lg">{exam.questionCount}</div>
                        <div className="text-[10px] text-muted-foreground">Questions</div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{attempted}/{exam.questionCount} attempted</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudentQuestionBankDashboard() {
  const { user } = useAuth();
  const isQuestionBankAccessLocked = isStudentFeatureLocked(user, "question-bank");

  if (isStudentPendingVerification(user)) {
    return <PendingQuestionBankPreview />;
  }

  return <ApprovedQuestionBankDashboard enabled featureLocked={isQuestionBankAccessLocked} />;
}

function StatCard({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${bg} ${color}`}>{icon}</div>
        <div>
          <div className="text-lg font-bold text-foreground">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  );
}
