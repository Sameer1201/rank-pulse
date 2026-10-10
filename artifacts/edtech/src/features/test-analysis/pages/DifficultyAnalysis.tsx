import { useMemo, useState } from "react";
import { difficultyData, comparativeDifficultyData } from "@/data/testData";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ViewMode } from "@/App";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { getSubjectTheme } from "@/lib/subject-theme";

const CELL_BORDER = "1px solid #e5e7eb";

type CompTab = string;

function subjectColor(tab: string) {
  return getSubjectTheme(tab).color;
}

function tabIcon(tab: string) {
  const color = subjectColor(tab);
  return (
    <span className="inline-flex" style={{ color }}>
      <SubjectSectionIcon label={tab} className="w-4 h-4" />
    </span>
  );
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

const thStyle: React.CSSProperties = {
  border: CELL_BORDER, padding: "10px 20px", textAlign: "left",
  fontSize: "12px", fontWeight: 600, color: "#6b7280", background: "#f9fafb",
};

function SubjectTabs({ active, onChange }: { active: CompTab; onChange: (t: CompTab) => void }) {
  const tabs = difficultyData.tabs as CompTab[];
  return (
    <div className="overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none]">
      <div className="flex min-w-max gap-1 border-b border-gray-200">
        {tabs.map((tab) => {
          const isActive = tab === active;
          const color = subjectColor(tab);
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium transition-all"
              style={{
                borderRadius: "6px 6px 0 0",
                marginBottom: -1,
                borderBottom: isActive ? `2px solid ${color}` : "2px solid transparent",
                color: isActive ? color : "#6b7280",
                background: isActive ? `${color}0d` : "transparent",
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

function ComparativeLevelSection({
  level, defaultTab, totals, rowsByTab,
}: {
  level: string;
  defaultTab: CompTab;
  totals: Record<string, number>;
  rowsByTab: Record<string, { student: string; icon: string; correct: number; wrong: number; notAttempted: number }[]>;
}) {
  const [tab, setTab] = useState<CompTab>(defaultTab);
  const totalQs = totals[tab];
  const rows = rowsByTab[tab];

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
      <div style={{ padding: "16px 24px 0" }}>
        <h3 className="text-base font-bold text-gray-900 mb-3">{level} ({totalQs} Qs)</h3>
        <SubjectTabs active={tab} onChange={setTab} />
      </div>
      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 200 }}>Students</th>
              <th style={{ ...thStyle, color: "#22c55e" }}>Attempted Correct</th>
              <th style={{ ...thStyle, color: "#ef4444" }}>Attempted Wrong</th>
              <th style={thStyle}>Not Attempted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.student}>
                <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                  <div className="flex items-center gap-2.5">
                    {studentIcons[row.icon]}
                    <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                  </div>
                </td>
                <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                  <span className="text-sm font-bold text-gray-900">{row.correct}</span>
                  <span className="text-xs text-gray-400">/{totalQs}</span>
                </td>
                <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                  <span className="text-sm font-bold text-gray-900">{row.wrong}</span>
                  <span className="text-xs text-gray-400">/{totalQs}</span>
                </td>
                <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                  <span className="text-sm font-bold text-gray-900">{row.notAttempted}</span>
                  <span className="text-xs text-gray-400">/{totalQs}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DifficultyAnalysis({ mode }: { mode?: ViewMode }) {
  const tabs = useMemo(() => difficultyData.tabs as CompTab[], [difficultyData.tabs]);
  const [analysisTab, setAnalysisTab] = useState<CompTab>(tabs[0] ?? "Overall");
  const [chartTab, setChartTab] = useState<CompTab>(tabs[0] ?? "Overall");

  const analysisRows = difficultyData.analysis[analysisTab as keyof typeof difficultyData.analysis];
  const chartRows = difficultyData.analysis[chartTab as keyof typeof difficultyData.analysis];

  const chartData = chartRows.map((r) => ({
    name: r.level,
    correct: r.correct,
    incorrect: r.wrong,
    unattempted: r.notAttempted,
  }));

  const maxY = Math.max(...chartData.map((d) => Math.max(d.correct, d.incorrect, d.unattempted))) + 4;

  if (mode === "comparative") {
    return (
      <div className="flex flex-col gap-5">
        {comparativeDifficultyData.levels.map((levelData) => {
          return (
            <ComparativeLevelSection
              key={levelData.level}
              level={levelData.level}
              defaultTab={tabs[0] ?? "Overall"}
              totals={levelData.totals}
              rowsByTab={levelData.rows}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Overall Analysis */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0", borderBottom: "none" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Overall Analysis</h3>
          <SubjectTabs active={analysisTab as CompTab} onChange={(t) => setAnalysisTab(t)} />
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 160 }}>Difficulty</th>
                <th style={{ ...thStyle, color: "#22c55e" }}>Attempted Correct</th>
                <th style={{ ...thStyle, color: "#ef4444" }}>Attempted Wrong</th>
                <th style={thStyle}>Not Attempted</th>
              </tr>
            </thead>
            <tbody>
              {analysisRows.map((row) => (
                <tr key={row.level}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-semibold text-gray-800">{row.level}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.correct}</span>
                    <span className="text-xs text-gray-400">/{row.total} Qs</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.wrong}</span>
                    <span className="text-xs text-gray-400">/{row.total} Qs</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.notAttempted}</span>
                    <span className="text-xs text-gray-400">/{row.total} Qs</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Graphical Analysis */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Graphical Analysis</h3>
          <SubjectTabs active={chartTab as CompTab} onChange={(t) => setChartTab(t)} />
        </div>
        <div className="p-5">
          <div className="flex items-center gap-5 mb-3">
            {[
              { label: "Correct",     color: "#22c55e" },
              { label: "Incorrect",   color: "#ef4444" },
              { label: "Unattempted", color: "#475569" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-gray-700">
                <span className="w-3 h-3 rounded-sm border border-gray-200 inline-block" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 20, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, maxY]} tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} Qs`} />
              <Tooltip />
              <Bar dataKey="correct"     fill="#22c55e" maxBarSize={36} radius={[3,3,0,0]}
                label={{ position: "top", fontSize: 11, fill: "#374151" }} />
              <Bar dataKey="incorrect"   fill="#ef4444" maxBarSize={36} radius={[3,3,0,0]}
                label={{ position: "top", fontSize: 11, fill: "#374151" }} />
              <Bar dataKey="unattempted" fill="#475569" maxBarSize={36} radius={[3,3,0,0]}
                label={{ position: "top", fontSize: 11, fill: "#374151" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
