import { AlertTriangle, Clock3, Medal, Plus, ShieldCheck, Sparkles, Target, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { attemptData, testData, timeData } from "@/data/testData";
import { getSubjectTheme } from "@/lib/subject-theme";

function ratio(score: number, max: number) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (score / max) * 100));
}

function formatSignedMarks(value: number) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
}

function StatTile({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: "neutral" | "green" | "orange" | "purple";
}) {
  const tones = {
    neutral: "border-[#E5E7EB] bg-white",
    green: "border-[#BBF7D0] bg-[#F0FDF4]",
    orange: "border-[#FED7AA] bg-[#FFF7ED]",
    purple: "border-[#DDD6FE] bg-[#F5F3FF]",
  } as const;

  return (
    <div className={`rounded-3xl border px-4 py-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">{label}</div>
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-[#F97316] shadow-sm">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-[28px] font-bold leading-none text-[#111827]">{value}</p>
      <p className="mt-2 text-sm text-[#6B7280]">{detail}</p>
    </div>
  );
}

function FocusCard({
  title,
  value,
  detail,
  icon,
  accent,
  valueIcon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: string;
  valueIcon?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">{title}</div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ background: accent }}
        >
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {valueIcon ? <span className="text-[#F97316]">{valueIcon}</span> : null}
        <p className="text-lg font-semibold text-[#111827]">{value}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#6B7280]">{detail}</p>
    </div>
  );
}

export default function Overview({ mode: _mode }: { mode?: string }) {
  const [learnings, setLearnings] = useState(["", ""]);

  const subjectCards = testData.subjectSummaries.slice(0, 4);
  const sectionRows = testData.performanceBreakdown.filter((row) => row.subject !== "Overall");
  const timeRows = timeData.breakdown.filter((row) => row.subject !== "Overall");
  const overallAttempt = attemptData.summary.find((row) => row.subject === "Overall");

  const strongestSection = useMemo(() => {
    return [...sectionRows].sort((a, b) => ratio(b.totalScore, b.maxTotalScore) - ratio(a.totalScore, a.maxTotalScore))[0] ?? null;
  }, [sectionRows]);

  const weakestSection = useMemo(() => {
    return [...sectionRows].sort((a, b) => ratio(a.totalScore, a.maxTotalScore) - ratio(b.totalScore, b.maxTotalScore))[0] ?? null;
  }, [sectionRows]);

  const slowestSection = useMemo(() => {
    return [...timeRows].sort((a, b) => b.timeSpent - a.timeSpent)[0] ?? null;
  }, [timeRows]);

  const biggestAttemptConcern = useMemo(() => {
    if (!overallAttempt) return null;
    const entries = [
      { label: "Perfect attempts", value: overallAttempt.perfect },
      { label: "Wasted attempts", value: overallAttempt.wasted },
      { label: "Overtime attempts", value: overallAttempt.overtime },
      { label: "Confused attempts", value: overallAttempt.confused },
    ];
    return entries.sort((a, b) => b.value - a.value)[0] ?? null;
  }, [overallAttempt]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="analysis-performance-snapshot overflow-hidden rounded-[30px] border border-[#DDE7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#FFFFFF_48%,#F8FAFF_100%)] p-6 shadow-sm">
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#F97316]">Performance Snapshot</p>
              <h3 className="mt-3 text-3xl font-bold tracking-tight text-[#111827]">
                {testData.overallScore}
                <span className="text-xl font-semibold text-[#9CA3AF]"> / {testData.maxScore}</span>
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#6B7280]">
                This is your current scoring position across the paper. Use the section snapshots below to spot where accuracy, speed, or selection quality needs work.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">Percentile</p>
                <p className="mt-2 text-lg font-semibold text-[#111827]">{testData.predictedPercentile}%ile</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">Rank</p>
                <p className="mt-2 text-lg font-semibold text-[#111827]">{testData.leaderboardRank}/{testData.totalParticipants.toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">Attempted</p>
                <p className="mt-2 text-lg font-semibold text-[#111827]">{testData.questionsAttempted}/{testData.totalQuestions}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">Accuracy</p>
                <p className="mt-2 text-lg font-semibold text-[#111827]">{testData.accuracy}%</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6B7280]">Current Pulse</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl bg-[#F8FAFC] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#6B7280]">Positive score</span>
                <span className="text-base font-semibold text-[#111827]">{testData.positiveScore}</span>
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8FAFC] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#6B7280]">Marks lost</span>
                <span className="text-base font-semibold text-[#111827]">{testData.marksLost}</span>
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8FAFC] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#6B7280]">Time used</span>
                <span className="text-base font-semibold text-[#111827]">{testData.timeTaken} min</span>
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8FAFC] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#6B7280]">Top issue</span>
                <span className="text-right text-base font-semibold text-[#111827]">
                  {biggestAttemptConcern ? `${biggestAttemptConcern.label} · ${biggestAttemptConcern.value}` : "Stable"}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Attempt quality"
          value={overallAttempt ? String(overallAttempt.perfect) : "0"}
          detail="Perfect attempts completed within expected time."
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="green"
        />
        <StatTile
          label="Speed pressure"
          value={overallAttempt ? String(overallAttempt.overtime) : "0"}
          detail="Questions where time exceeded the expected range."
          icon={<Clock3 className="h-4 w-4" />}
          tone="orange"
        />
        <StatTile
          label="Waste spots"
          value={overallAttempt ? String(overallAttempt.wasted) : "0"}
          detail="Incorrect attempts that still consumed decision time."
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="neutral"
        />
        <StatTile
          label="Leaderboard"
          value={`#${testData.leaderboardRank || 0}`}
          detail={`Out of ${testData.totalParticipants.toLocaleString()} participants`}
          icon={<Medal className="h-4 w-4" />}
          tone="purple"
        />
      </div>

      <section className="rounded-[30px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6B7280]">Section Snapshots</p>
            <h3 className="mt-2 text-xl font-semibold text-[#111827]">Where the paper moved well, and where it slowed down</h3>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {subjectCards.map((subject) => {
            const matchingPerformance = sectionRows.find((row) => row.subject === subject.label);
            const matchingTime = timeRows.find((row) => row.subject === subject.label);
            const progress = ratio(subject.score, subject.max);
            const theme = getSubjectTheme(subject.label);

            return (
              <div key={subject.key} className="rounded-3xl border border-[#E5E7EB] bg-[#FCFCFE] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span style={{ color: theme.color }}>
                        <SubjectSectionIcon label={subject.label} className="h-4 w-4" />
                      </span>
                      <p className="text-base font-semibold text-[#111827]">{subject.label}</p>
                    </div>
                    <p className="mt-1 text-sm text-[#6B7280]">{subject.percentile}%ile estimate</p>
                  </div>
                  <div
                    className="flex h-10 min-w-10 items-center justify-center rounded-2xl border px-2 text-sm font-semibold"
                    style={{
                      backgroundColor: theme.softBgStrong,
                      borderColor: theme.softBorder,
                      color: theme.color,
                    }}
                  >
                    {Math.round(progress)}%
                  </div>
                </div>

                <div className="mt-4 h-2 rounded-full bg-[#EEF2F7]">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${progress}%`, backgroundColor: theme.color }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-[#6B7280]">Score</p>
                    <p className="mt-1 font-semibold text-[#111827]">{subject.score}/{subject.max}</p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-[#6B7280]">Attempted</p>
                    <p className="mt-1 font-semibold text-[#111827]">
                      {matchingPerformance ? `${matchingPerformance.attemptedCorrect + matchingPerformance.attemptedWrong}/${matchingPerformance.totalQs}` : "0/0"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-[#6B7280]">Accuracy</p>
                    <p className="mt-1 font-semibold text-[#111827]">
                      {matchingPerformance && matchingPerformance.attemptedCorrect + matchingPerformance.attemptedWrong > 0
                        ? `${Math.round((matchingPerformance.attemptedCorrect / (matchingPerformance.attemptedCorrect + matchingPerformance.attemptedWrong)) * 100)}%`
                        : "0%"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-3">
                    <p className="text-[#6B7280]">Time spent</p>
                    <p className="mt-1 font-semibold text-[#111827]">{matchingTime ? `${matchingTime.timeSpent} min` : "0 min"}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <FocusCard
          title="Strongest Section"
          value={strongestSection?.subject ?? "Not enough data"}
          valueIcon={strongestSection ? <span style={{ color: getSubjectTheme(strongestSection.subject).color }}><SubjectSectionIcon label={strongestSection.subject} className="h-4 w-4" /></span> : undefined}
          detail={
            strongestSection
              ? `${formatSignedMarks(strongestSection.totalScore)} out of ${strongestSection.maxTotalScore}, with ${strongestSection.attemptedCorrect} correct answers.`
              : "Complete more questions to identify your strongest section."
          }
          icon={<Sparkles className="h-4 w-4" />}
          accent="linear-gradient(135deg, #22C55E 0%, #16A34A 100%)"
        />
        <FocusCard
          title="Needs Attention"
          value={weakestSection?.subject ?? "Not enough data"}
          valueIcon={weakestSection ? <span style={{ color: getSubjectTheme(weakestSection.subject).color }}><SubjectSectionIcon label={weakestSection.subject} className="h-4 w-4" /></span> : undefined}
          detail={
            weakestSection
              ? `${weakestSection.notAttempted} not attempted and ${weakestSection.attemptedWrong} wrong in this section.`
              : "No weak section is visible yet."
          }
          icon={<Target className="h-4 w-4" />}
          accent="linear-gradient(135deg, #F97316 0%, #EA580C 100%)"
        />
        <FocusCard
          title="Pacing Watch"
          value={slowestSection?.subject ?? "Balanced pacing"}
          valueIcon={slowestSection ? <span style={{ color: getSubjectTheme(slowestSection.subject).color }}><SubjectSectionIcon label={slowestSection.subject} className="h-4 w-4" /></span> : undefined}
          detail={
            slowestSection
              ? `${slowestSection.timeSpent} minutes spent here, with ${slowestSection.accuracy}% accuracy.`
              : "No pacing issue detected yet."
          }
          icon={<TrendingUp className="h-4 w-4" />}
          accent="linear-gradient(135deg, #5B4DFF 0%, #4338CA 100%)"
        />
      </div>

      <section className="rounded-[30px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FFF7ED] text-[#F97316]">
            <Plus className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#111827]">Learning Notes</h3>
            <p className="mt-1 text-sm text-[#6B7280]">Keep a quick log of what you learned from this test.</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {learnings.map((learning, index) => (
            <div key={index} className="rounded-2xl border border-[#E5E7EB] bg-[#FCFCFE] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#FFF7ED] text-xs font-semibold text-[#F97316]">
                  {index + 1}
                </span>
                <input
                  value={learning}
                  onChange={(event) => {
                    const updated = [...learnings];
                    updated[index] = event.target.value;
                    setLearnings(updated);
                  }}
                  className="w-full bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF]"
                  placeholder="Add a takeaway from this test..."
                />
              </div>
            </div>
          ))}

          {learnings.length < 3 ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#FED7AA] px-4 py-2 text-sm font-medium text-[#F97316] transition-colors hover:bg-[#FFF7ED]"
              onClick={() => setLearnings((current) => [...current, ""])}
            >
              <Plus className="h-4 w-4" />
              Add another note
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
