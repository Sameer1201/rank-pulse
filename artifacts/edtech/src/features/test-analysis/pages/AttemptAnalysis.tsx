import { useMemo, useState } from "react";
import { attemptData, comparativeAttemptData } from "@/data/testData";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
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

const categoryIcons: Record<string, React.ReactNode> = {
  check:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#22c55e" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  x:       <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  clock:   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#f97316" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/></svg>,
  confused:<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

const thStyle: React.CSSProperties = {
  border: CELL_BORDER, padding: "10px 20px", textAlign: "left",
  fontSize: "12px", fontWeight: 600, color: "#6b7280", background: "#f9fafb",
};

const CHART_COLORS = {
  perfect: "#22c55e", wasted: "#ef4444", overtime: "#f97316", confused: "#475569",
};

const SERIES = [
  { key: "perfect",  label: "Perfect",  color: CHART_COLORS.perfect  },
  { key: "wasted",   label: "Wasted",   color: CHART_COLORS.wasted   },
  { key: "overtime", label: "Overtime", color: CHART_COLORS.overtime  },
  { key: "confused", label: "Confused", color: CHART_COLORS.confused  },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

const COMP_SERIES = [
  { key: "you" as const,    label: "You",        color: "#f97316" },
  { key: "topper" as const, label: "Topper",     color: "#22c55e" },
  { key: "top10" as const,  label: "Top 10%ile", color: "#3b82f6" },
  { key: "top25" as const,  label: "Top 25%ile", color: "#eab308" },
];
type CompSeries = (typeof COMP_SERIES)[number]["key"];

function SubjectTabs({ active, onChange }: { active: CompTab; onChange: (t: CompTab) => void }) {
  const tabs = [...new Set(["Overall", ...attemptData.summary.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[];
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

function CheckboxLegend({
  series, checked, onToggle,
}: {
  series: { key: string; label: string; color: string }[];
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {series.map((s) => (
        <button
          key={s.key}
          onClick={() => onToggle(s.key)}
          className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 transition-colors"
        >
          <span
            className="w-4 h-4 rounded-sm inline-flex items-center justify-center border-2 transition-colors"
            style={{ borderColor: s.color, background: checked[s.key] ? s.color : "white" }}
          >
            {checked[s.key] && (
              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
              </svg>
            )}
          </span>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function ComparativeView({ defaultTab }: { defaultTab: CompTab }) {
  const [tabularTab, setTabularTab] = useState<CompTab>(defaultTab);
  const [graphicalTab, setGraphicalTab] = useState<CompTab>(defaultTab);
  const tabularRows = comparativeAttemptData.tabular[tabularTab];
  const graphicalRows = comparativeAttemptData.graphical[graphicalTab];

  const [compChecked, setCompChecked] = useState<Record<CompSeries, boolean>>({
    you: true, topper: true, top10: true, top25: true,
  });
  const toggleComp = (key: string) =>
    setCompChecked((prev) => ({ ...prev, [key]: !prev[key as CompSeries] }));

  return (
    <div className="flex flex-col gap-5">
      {/* Tabular Analysis */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Tabular Analysis</h3>
          <SubjectTabs active={tabularTab} onChange={setTabularTab} />
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 200 }}>Students</th>
                <th style={{ ...thStyle, color: "#22c55e" }}>
                  <span className="flex items-center gap-1">{categoryIcons.check} Perfect</span>
                </th>
                <th style={{ ...thStyle, color: "#ef4444" }}>
                  <span className="flex items-center gap-1">{categoryIcons.x} Wasted</span>
                </th>
                <th style={{ ...thStyle, color: "#f97316" }}>
                  <span className="flex items-center gap-1">{categoryIcons.clock} Overtime</span>
                </th>
                <th style={{ ...thStyle, color: "#6366f1" }}>
                  <span className="flex items-center gap-1">{categoryIcons.confused} Confused</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tabularRows.map((row) => (
                <tr key={row.student}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      {studentIcons[row.icon]}
                      <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                    </div>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.perfect}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.wasted}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.overtime}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.confused}</span>
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
          <SubjectTabs active={graphicalTab} onChange={setGraphicalTab} />
        </div>
        <div className="p-5">
          <CheckboxLegend series={COMP_SERIES} checked={compChecked} onToggle={toggleComp} />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={graphicalRows} margin={{ top: 24, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="category" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} Qs`} />
              <Tooltip />
              {COMP_SERIES.map((s) =>
                compChecked[s.key] ? (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} maxBarSize={28} radius={[3, 3, 0, 0]}>
                    <LabelList dataKey={s.key} position="top" style={{ fontSize: 11, fill: "#374151" }} />
                  </Bar>
                ) : null
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function AttemptAnalysis({ mode }: { mode?: ViewMode }) {
  const tabs = useMemo(() => [...new Set(["Overall", ...attemptData.summary.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[], [attemptData.summary]);
  const [checked, setChecked] = useState<Record<SeriesKey, boolean>>({
    perfect: true, wasted: true, overtime: false, confused: false,
  });
  const toggle = (key: SeriesKey) =>
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));

  if (mode === "comparative") {
    return (
      <div className="flex flex-col gap-5">
        {/* Category Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {attemptData.categories.map((cat) => (
            <div key={cat.key} className="bg-white rounded-xl p-4" style={{ border: CELL_BORDER }}>
              <div className="flex items-center gap-1.5 mb-1">
                {categoryIcons[cat.icon]}
                <span className="text-sm font-semibold" style={{ color: cat.color }}>{cat.label}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{cat.desc}</p>
            </div>
          ))}
        </div>
        <ComparativeView defaultTab={tabs[0] ?? "Overall"} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Category Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {attemptData.categories.map((cat) => (
          <div key={cat.key} className="bg-white rounded-xl p-4" style={{ border: CELL_BORDER }}>
            <div className="flex items-center gap-1.5 mb-1">
              {categoryIcons[cat.icon]}
              <span className="text-sm font-semibold" style={{ color: cat.color }}>{cat.label}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{cat.desc}</p>
          </div>
        ))}
      </div>

      {/* Summary Table */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 180 }}>Subject</th>
                <th style={{ ...thStyle, color: "#22c55e" }}>
                  <span className="flex items-center gap-1">{categoryIcons.check} Perfect</span>
                </th>
                <th style={{ ...thStyle, color: "#ef4444" }}>
                  <span className="flex items-center gap-1">{categoryIcons.x} Wasted</span>
                </th>
                <th style={{ ...thStyle, color: "#f97316" }}>
                  <span className="flex items-center gap-1">{categoryIcons.clock} Overtime</span>
                </th>
                <th style={{ ...thStyle, color: "#6366f1" }}>
                  <span className="flex items-center gap-1">{categoryIcons.confused} Confused</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {attemptData.summary.map((row) => (
                <tr key={row.subject}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border"
                        style={{
                          backgroundColor: getSubjectTheme(row.subject).softBgStrong,
                          borderColor: getSubjectTheme(row.subject).softBorder,
                          color: getSubjectTheme(row.subject).color,
                        }}
                      >
                        <SubjectSectionIcon label={row.subject} className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{row.subject}</span>
                    </div>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.perfect}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.wasted}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.overtime}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.confused}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Graphical View */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Graphical View of Attempts</h3>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-5 mb-4 flex-wrap">
            {SERIES.map((s) => (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 transition-colors"
              >
                <span
                  className="w-4 h-4 rounded-sm inline-flex items-center justify-center border-2 transition-colors"
                  style={{ borderColor: s.color, background: checked[s.key] ? s.color : "white" }}
                >
                  {checked[s.key] && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
                    </svg>
                  )}
                </span>
                {s.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={attemptData.chartData} margin={{ top: 20, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} Qs`} />
              <Tooltip />
              {SERIES.map((s) =>
                checked[s.key] ? (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} maxBarSize={36} radius={[3,3,0,0]}
                    label={{ position: "top", fontSize: 11, fill: "#374151" }} />
                ) : null
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
