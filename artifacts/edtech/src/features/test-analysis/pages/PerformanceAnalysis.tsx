import { useMemo, useState } from "react";
import { testData, comparativeData } from "@/data/testData";
import type { ViewMode } from "@/App";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { getSubjectTheme } from "@/lib/subject-theme";

type CompTab = string;

function subjectColor(tab: string) {
  return getSubjectTheme(tab).color;
}

function tabIcon(tab: string) {
  const color = subjectColor(tab);
  return <span className="inline-flex" style={{ color }}><SubjectSectionIcon label={tab} className="w-4 h-4" /></span>;
}

const studentIcons: Record<string, React.ReactNode> = {
  user: (
    <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  top10: (
    <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="9" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M2 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="8" r="2.5" />
      <path strokeLinecap="round" d="M17 14c2.5 0 5 1.5 5 4.5" />
    </svg>
  ),
  top25: (
    <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="9" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M2 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="8" r="2.5" />
      <path strokeLinecap="round" d="M17 14c2.5 0 5 1.5 5 4.5" />
    </svg>
  ),
};

const accuracyTheme = { bar: "#22c55e", gradient: "linear-gradient(to right, transparent, rgba(34,197,94,0.18))" };

function subjectTheme(subject: string) {
  const theme = getSubjectTheme(subject);
  return {
    bar: theme.color,
    gradient: theme.gradient,
  };
}

const CELL_BORDER = "1px solid #e5e7eb";

function AccentCell({
  value,
  total,
  subject,
  strong,
}: {
  value: number;
  total: number;
  subject: string;
  strong?: boolean;
}) {
  const theme = subjectTheme(subject);
  const pct = total > 0 ? (value / total) * 100 : 0;

  return (
    <td style={{ border: CELL_BORDER, padding: 0, minWidth: 130 }}>
      <div
        className="relative flex items-center overflow-hidden"
        style={{ padding: "14px 20px", minHeight: 56 }}
      >
        <div
          className="absolute inset-y-0 left-0 pointer-events-none"
          style={{ width: `${pct}%`, background: theme.gradient }}
        />
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={
            pct === 0
              ? { left: 0, width: "2.5px", background: theme.bar }
              : { left: `${pct}%`, width: "2.5px", background: theme.bar, transform: "translateX(-100%)" }
          }
        />
        <div className="relative flex items-baseline gap-1 z-10">
          <span
            className="font-bold text-gray-900 leading-none"
            style={{ fontSize: strong ? "20px" : "14px" }}
          >
            {value}
          </span>
          <span className="text-xs text-gray-400 font-normal">/ {total}</span>
        </div>
      </div>
    </td>
  );
}

function ScoreBarCell({ value, maxScore, subject }: { value: number; maxScore: number; subject: string }) {
  const theme = subjectTheme(subject);
  const pct = maxScore > 0 ? (value / maxScore) * 100 : 0;
  return (
    <td style={{ border: CELL_BORDER, padding: 0, minWidth: 160 }}>
      <div className="relative flex items-center overflow-hidden" style={{ padding: "14px 20px", minHeight: 56 }}>
        <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${pct}%`, background: theme.gradient }} />
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: `${pct}%`, width: "2.5px", background: theme.bar, transform: "translateX(-100%)" }}
        />
        <div className="relative flex items-baseline gap-1 z-10">
          <span className="text-sm font-bold text-gray-900">{value}</span>
          <span className="text-xs text-gray-400">/ {maxScore}</span>
        </div>
      </div>
    </td>
  );
}

function AccuracyBarCell({ value }: { value: number }) {
  const pct = value;
  return (
    <td style={{ border: CELL_BORDER, padding: 0, minWidth: 130 }}>
      <div className="relative flex items-center overflow-hidden" style={{ padding: "14px 20px", minHeight: 56 }}>
        <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${pct}%`, background: accuracyTheme.gradient }} />
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: `${pct}%`, width: "2.5px", background: accuracyTheme.bar, transform: "translateX(-100%)" }}
        />
        <div className="relative z-10">
          <span className="text-sm font-bold text-gray-900">{value}%</span>
        </div>
      </div>
    </td>
  );
}

function SubjectTabs({ active, onChange }: { active: CompTab; onChange: (t: CompTab) => void }) {
  const tabs = [...new Set(["Overall", ...testData.performanceBreakdown.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[];
  return (
    <div className="overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none]">
      <div className="flex min-w-max gap-1 p-1" style={{ borderBottom: CELL_BORDER }}>
        {tabs.map((tab) => {
          const isActive = tab === active;
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                color: isActive ? subjectColor(tab) : "#6b7280",
                background: isActive ? `${subjectColor(tab)}14` : "transparent",
                border: isActive ? `1px solid ${subjectColor(tab)}4d` : "1px solid transparent",
              }}
            >
              {tabIcon(tab)}
              {tab}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComparativeView({ subject }: { subject: CompTab }) {
  const perfRows = comparativeData.performance[subject];
  const brkRows = comparativeData.breakdown[subject];

  const thStyle: React.CSSProperties = {
    border: CELL_BORDER,
    padding: "10px 20px",
    textAlign: "left",
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    background: "#f9fafb",
    whiteSpace: "nowrap",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Test Performance */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Test Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 180 }}>Students</th>
                <th style={{ ...thStyle, minWidth: 160 }}>Score</th>
                <th style={{ ...thStyle, minWidth: 130 }}>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {perfRows.map((row) => (
                <tr key={row.student}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      {studentIcons[row.icon]}
                      <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                    </div>
                  </td>
                  <ScoreBarCell value={row.score} maxScore={row.maxScore} subject={subject} />
                  <AccuracyBarCell value={row.accuracy} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Test Breakdown */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Test Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 180 }}>Students</th>
                <th style={{ ...thStyle, minWidth: 140 }}>
                  <span style={{ color: "#22c55e" }}>Attempted<br />Correct</span>
                </th>
                <th style={{ ...thStyle, minWidth: 130 }}>
                  <span style={{ color: "#ef4444" }}>Attempted<br />Wrong</span>
                </th>
                <th style={{ ...thStyle, minWidth: 140 }}>
                  <span style={{ color: "#6366f1" }}>Not Attempted</span>
                </th>
                <th style={{ ...thStyle, minWidth: 120 }}>Not Visited Qs</th>
              </tr>
            </thead>
            <tbody>
              {brkRows.map((row) => (
                <tr key={row.student}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      {studentIcons[row.icon]}
                      <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                    </div>
                  </td>
                  <AccentCell value={row.attemptedCorrect} total={row.totalQs} subject={subject} />
                  <AccentCell value={row.attemptedWrong} total={row.totalQs} subject={subject} />
                  <AccentCell value={row.notAttempted} total={row.totalQs} subject={subject} strong={row.notAttempted >= 10} />
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm text-gray-400 italic">No data</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PerformanceAnalysis({ mode }: { mode: ViewMode }) {
  const { performanceBreakdown } = testData;
  const tabs = useMemo(() => [...new Set(["Overall", ...performanceBreakdown.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[], [performanceBreakdown]);
  const [activeTab, setActiveTab] = useState<CompTab>(tabs[0] ?? "Overall");

  const thStyle: React.CSSProperties = {
    border: CELL_BORDER,
    padding: "10px 20px",
    textAlign: "left",
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    background: "#f9fafb",
    whiteSpace: "nowrap" as const,
  };

  if (mode === "comparative") {
    return (
      <div className="flex flex-col gap-4">
        {/* Subject Tabs row */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e5e7eb" }}>
          <SubjectTabs active={activeTab} onChange={setActiveTab} />
        </div>
        <ComparativeView subject={activeTab} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #111827" }}>
      <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
        <h3 className="text-base font-bold text-gray-900">Test Breakdown</h3>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 180 }}>Subject</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Total Score</th>
              <th style={{ ...thStyle, minWidth: 140 }}>
                Attempted<br />Correct
              </th>
              <th style={{ ...thStyle, minWidth: 130 }}>
                Attempted<br />Wrong
              </th>
              <th style={{ ...thStyle, minWidth: 140 }}>Not Attempted</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Not Visited Qs</th>
            </tr>
          </thead>
          <tbody>
            {performanceBreakdown.map((row) => {
              const theme = subjectTheme(row.subject);
              const totalPct = (row.totalScore / row.maxTotalScore) * 100;

              return (
                <tr key={row.subject}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex" style={{ color: theme.bar }}>
                        <SubjectSectionIcon label={row.subject} className="w-4 h-4" />
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{row.subject}</span>
                    </div>
                  </td>

                  <td style={{ border: CELL_BORDER, padding: 0, minWidth: 120 }}>
                    <div
                      className="relative flex items-center overflow-hidden"
                      style={{ padding: "14px 20px", minHeight: 56 }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{ width: `${totalPct}%`, background: theme.gradient }}
                      />
                      <div
                        className="absolute inset-y-0 pointer-events-none"
                        style={{
                          left: `${totalPct}%`,
                          width: "2.5px",
                          background: theme.bar,
                          transform: "translateX(-100%)",
                        }}
                      />
                      <div className="relative flex items-baseline gap-1 z-10">
                        <span className="text-sm font-bold text-gray-900">{row.totalScore}</span>
                        <span className="text-xs text-gray-400">/ {row.maxTotalScore}</span>
                      </div>
                    </div>
                  </td>

                  <AccentCell value={row.attemptedCorrect} total={row.totalQs} subject={row.subject} />
                  <AccentCell value={row.attemptedWrong} total={row.totalQs} subject={row.subject} />
                  <AccentCell
                    value={row.notAttempted}
                    total={row.totalQs}
                    subject={row.subject}
                    strong={row.notAttempted >= 10}
                  />
                  <AccentCell
                    value={row.notVisited}
                    total={row.totalQs}
                    subject={row.subject}
                    strong={row.notVisited >= 10}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
