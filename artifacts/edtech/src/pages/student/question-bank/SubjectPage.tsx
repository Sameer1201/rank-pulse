import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Filter, Lock } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import PendingVerificationDialog from "@/components/student/PendingVerificationDialog";
import { PerformanceInsightButton } from "@/components/student/PerformanceInsightButton";
import { useAuth } from "@/contexts/AuthContext";
import { isStudentFeatureLocked, isStudentPendingVerification } from "@/lib/student-access";
import { SubjectThemeIcon, getSubjectAccent, getSubjectTheme } from "@/lib/subject-theme";
import { formatTimeSpent } from "@/lib/question-timer";
import { buildStudentUnlockPath } from "@/lib/student-unlock";
import {
  applyPendingPreviewLocksToStructure,
  useStudentQuestionBankStructure,
} from "@/pages/student/question-bank/api";

export default function StudentQuestionBankSubjectPage() {
  const { examId, subjectId } = useParams<{ examId: string; subjectId: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isPreviewMode = isStudentPendingVerification(user);
  const isQuestionBankFeatureLocked = isStudentFeatureLocked(user, "question-bank");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: liveData, isLoading } = useStudentQuestionBankStructure(examId);
  const data = useMemo(() => {
    if (!liveData) return null;
    return isPreviewMode ? applyPendingPreviewLocksToStructure(liveData) : liveData;
  }, [isPreviewMode, liveData]);

  if (isLoading) {
    return <div className="py-20 text-center text-muted-foreground">Loading subject question bank...</div>;
  }

  const exam = data?.exam;
  const subject = data?.subjects.find((entry) => String(entry.id) === subjectId);

  if (!exam || !subject) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Not found.{" "}
        <Link to="/student/question-bank" className="text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  if (subject.isLocked && !isQuestionBankFeatureLocked) {
    return (
      <>
        <div className="space-y-6">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link to={`/student/question-bank/exam/${examId}`}>
              <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            </Link>
          </div>

          <div className="rounded-2xl border border-[#F3D39A] bg-[linear-gradient(180deg,#FFF8ED_0%,#FFFFFF_100%)] p-6 shadow-sm">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3D39A] bg-[#FFF2D8] px-3 py-1 text-xs font-semibold text-[#B45309]">
                <Lock className="h-3.5 w-3.5" />
                Locked subject
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{subject.title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                  This subject is locked in review mode. Only one GATE subject is open until your verification is approved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-full bg-[#F59E0B] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#EA580C]"
              >
                Unlock after verification
              </button>
            </div>
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

  const totalQuestions = subject.chapters.reduce((s, c) => s + c.questionCount, 0);
  const totalAttempted = subject.chapters.reduce((s, c) => s + c.attemptedCount, 0);
  const totalTimeSpent = subject.chapters.reduce((s, c) => s + (c.totalTimeSpentSeconds ?? 0), 0);
  const subjectTheme = getSubjectTheme(subject.title);
  const subjectAccent = getSubjectAccent(subject.title);

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Link to={`/student/question-bank/exam/${examId}`}>
            <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/student/question-bank" className="hover:text-primary">
              Dashboard
            </Link>
            <span>/</span>
            <Link to={`/student/question-bank/exam/${examId}`} className="hover:text-primary">
              {exam.label}
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">{subject.title}</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full border"
                  style={{
                    backgroundColor: subjectTheme.softBgStrong,
                    borderColor: subjectTheme.softBorder,
                    color: subjectTheme.color,
                  }}
                >
                  <SubjectThemeIcon label={subject.title} className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground">{subject.title}</h1>
                  <p className="text-xs text-muted-foreground">{exam.label}</p>
                </div>
              </div>
            </div>
            <div className="grid w-full grid-cols-3 gap-3 text-center sm:w-auto sm:flex sm:gap-4">
              {[
                { label: "Chapters", value: subject.chapters.length },
                { label: "Questions", value: totalQuestions },
                { label: "Attempted", value: totalAttempted },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-xl font-bold text-foreground sm:text-2xl">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
          {totalTimeSpent > 0 ? <div className="mt-3 text-xs text-muted-foreground">Total time spent · <span className="font-semibold tabular-nums text-foreground">{formatTimeSpent(totalTimeSpent)}</span></div> : null}
        </div>

        <div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-foreground">Chapters</h2>
          </div>

          {subject.chapters.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No chapters found.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {subject.chapters.map((chapter) => {
                const pct = chapter.questionCount > 0 ? Math.round((chapter.attemptedCount / chapter.questionCount) * 100) : 0;
                const isLockedChapter = isQuestionBankFeatureLocked || Boolean(chapter.isLocked);

                return (
                  <div key={chapter.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                      if (isLockedChapter) {
                        if (isQuestionBankFeatureLocked) {
                          setLocation(buildStudentUnlockPath({
                            feature: "question-bank",
                            kind: "chapter",
                            label: chapter.title,
                            examLabel: exam.label,
                            subjectLabel: subject.title,
                            returnTo: `/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapter.id}`,
                          }));
                          return;
                        }
                        setDialogOpen(true);
                        return;
                      }
                      setLocation(`/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapter.id}`);
                    }}
                    className="block w-full text-left"
                  >
                    <div className="group rounded-xl border border-border bg-card p-4 pr-12 shadow-sm transition-all hover:border-primary/40 hover:shadow-md">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground">{chapter.title}</h3>
                            {isLockedChapter ? (
                              <span className="chip-orange-solid rounded-full px-2 py-0.5 text-[10px] font-medium">Locked</span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{chapter.questionCount} questions</p>
                        </div>
                        {isLockedChapter ? (
                          <Lock className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        )}
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {chapter.attemptedCount}/{chapter.questionCount} attempted{(chapter.totalTimeSpentSeconds ?? 0) > 0 ? ` · ${formatTimeSpent(chapter.totalTimeSpentSeconds!)} spent` : ""}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: subjectAccent.line }}
                          />
                        </div>
                      </div>
                    </div>
                  </button>
                  {!isLockedChapter ? (
                    <div className="absolute bottom-3 right-3">
                      <PerformanceInsightButton target={{ source: "question-bank", scope: "chapter", exam: examId, subjectId: subject.id, chapterId: chapter.id, label: chapter.title }} />
                    </div>
                  ) : null}
                  </div>
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
