import { useMemo, useState } from "react";
import { timeData, comparativeTimeData } from "@/data/testData";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from "recharts";
import type { ViewMode } from "@/App";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { getSubjectTheme } from "@/lib/subject-theme";

const CELL_BORDER = "1px solid #e5e7eb";

type CompTab = string;
type HourTab = "Overall" | "Correct" | "Incorrect";
type GraphTab = "Correct" | "Incorrect";

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

const thStyle: React.CSSProperties = {
  border: CELL_BORDER, padding: "10px 20px", textAlign: "left",
  fontSize: "12px", fontWeight: 600, color: "#6b7280", background: "#f9fafb",
};

const subjectWiseTabs = ["Time Spent", "Questions Attempted", "Accuracy"];

const COMP_SERIES = [
  { key: "you" as const,    label: "You",        color: "#f97316" },
  { key: "topper" as const, label: "Topper",     color: "#22c55e" },
  { key: "top10" as const,  label: "Top 10%ile", color: "#3b82f6" },
  { key: "top25" as const,  label: "Top 25%ile", color: "#eab308" },
];
type CompSeriesKey = (typeof COMP_SERIES)[number]["key"];

function SubjectTabs({ active, onChange }: { active: CompTab; onChange: (t: CompTab) => void }) {
  const tabs = [...new Set(["Overall", ...timeData.breakdown.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[];
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

function BarCell({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <td style={{ border: CELL_BORDER, padding: 0, minWidth: 150 }}>
      <div className="relative flex items-center overflow-hidden" style={{ padding: "14px 20px", minHeight: 52 }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: `${color}14` }} />
        <div className="absolute inset-y-0" style={{ left: `${pct}%`, width: "2.5px", background: color, transform: "translateX(-100%)" }} />
        <span className="relative z-10 text-sm font-bold text-gray-900">{label}</span>
      </div>
    </td>
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

function SmallTab({
  tabs, active, onChange,
}: {
  tabs: { key: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-all"
            style={{
              borderRadius: "6px 6px 0 0",
              marginBottom: -1,
              borderBottom: isActive ? "2px solid #6366f1" : "2px solid transparent",
              color: isActive ? "#6366f1" : "#6b7280",
              background: isActive ? "#6366f10d" : "transparent",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function ComparativeView({ defaultTab }: { defaultTab: CompTab }) {
  const [subjectTab, setSubjectTab] = useState<CompTab>(defaultTab);
  const breakdownRows = comparativeTimeData.breakdown[subjectTab];
  const [hourTab, setHourTab] = useState<HourTab>("Overall");
  const [graphTab, setGraphTab] = useState<GraphTab>("Correct");
  const [compChecked, setCompChecked] = useState<Record<CompSeriesKey, boolean>>({
    you: true, topper: true, top10: true, top25: true,
  });
  const toggleComp = (key: string) =>
    setCompChecked((prev) => ({ ...prev, [key]: !prev[key as CompSeriesKey] }));

  const hourRows = comparativeTimeData.hourWise.data[hourTab];
  const graphRows = comparativeTimeData.graphical.data[graphTab];

  const hourTabs = [
    { key: "Overall",   label: "Overall",    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg> },
    { key: "Correct",   label: "Correct",    icon: <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> },
    { key: "Incorrect", label: "Incorrect",  icon: <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> },
  ];

  const graphTabs = [
    { key: "Correct",   label: "Correct",   icon: <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> },
    { key: "Incorrect", label: "Incorrect", icon: <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Time Breakdown */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Time Breakdown</h3>
          <SubjectTabs active={subjectTab} onChange={setSubjectTab} />
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 200 }}>Students</th>
                <th style={thStyle}>Time Spent</th>
                <th style={thStyle}>Qs Attempted</th>
                <th style={thStyle}>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {breakdownRows.map((row) => (
                <tr key={row.student}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      {studentIcons[row.icon]}
                      <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                    </div>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.timeMins}</span>
                    <span className="text-xs text-gray-400 ml-1">mins</span>
                  </td>
                  <BarCell pct={row.qsPct} color="#6366f1" label={`${row.qsPct}%`} />
                  <BarCell pct={row.accuracy} color="#22c55e" label={`${row.accuracy}%`} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hour Wise Breakdown */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Hour Wise Breakdown</h3>
          <SmallTab tabs={hourTabs} active={hourTab} onChange={(t) => setHourTab(t as HourTab)} />
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 200 }}>Students</th>
                <th style={thStyle}>{comparativeTimeData.phaseLabels[0]}</th>
                <th style={thStyle}>{comparativeTimeData.phaseLabels[1]}</th>
                <th style={thStyle}>{comparativeTimeData.phaseLabels[2]}</th>
              </tr>
            </thead>
            <tbody>
              {hourRows.map((row) => (
                <tr key={row.student}>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <div className="flex items-center gap-2.5">
                      {studentIcons[row.icon]}
                      <span className="text-sm font-semibold text-gray-800">{row.student}</span>
                    </div>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.hour1}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.hour2}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.hour3}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Graphical Hour-Wise Breakdown */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Graphical Hour-Wise Breakdown</h3>
          <SmallTab tabs={graphTabs} active={graphTab} onChange={(t) => setGraphTab(t as GraphTab)} />
        </div>
        <div className="p-5">
          <CheckboxLegend series={COMP_SERIES} checked={compChecked} onToggle={toggleComp} />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={graphRows} margin={{ top: 12, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} Qs`} />
              <Tooltip />
              {COMP_SERIES.map((s) =>
                compChecked[s.key] ? (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.5} dot={false} />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function TimeAnalysis({ mode }: { mode?: ViewMode }) {
  const tabs = useMemo(() => [...new Set(["Overall", ...timeData.breakdown.filter((row) => row.subject !== "Overall").map((row) => row.subject)])] as CompTab[], [timeData.breakdown]);
  const [swTab, setSwTab] = useState("Time Spent");
  const [qualTab, setQualTab] = useState(tabs[0] ?? "Overall");

  const LINE_SERIES = [
    { key: "correct",   label: "Correct",   color: "#22c55e" },
    { key: "incorrect", label: "Incorrect", color: "#ef4444" },
    { key: "overall",   label: "Overall",   color: "#475569" },
  ] as const;
  type LineKey = (typeof LINE_SERIES)[number]["key"];
  const [lineChecked, setLineChecked] = useState<Record<LineKey, boolean>>({
    correct: true, incorrect: true, overall: true,
  });
  const toggleLine = (key: LineKey) =>
    setLineChecked((prev) => ({ ...prev, [key]: !prev[key] }));

  const qualTabKeys = timeData.qualityOfTime.tabs;
  const qual = timeData.qualityOfTime.data[qualTab as keyof typeof timeData.qualityOfTime.data];

  const swChartData = timeData.subjectChart.map((s) => {
    const theme = getSubjectTheme(s.name);
    if (swTab === "Time Spent") return { name: s.name, value: s.time, color: theme.color, unit: "mins" };
    if (swTab === "Questions Attempted") {
      const row = timeData.breakdown.find((r) => r.subject === s.name);
      return { name: s.name, value: row?.qsAttempted ?? 0, color: theme.color, unit: "Qs" };
    }
    const row = timeData.breakdown.find((r) => r.subject === s.name);
    return { name: s.name, value: row?.accuracy ?? 0, color: theme.color, unit: "%" };
  });

  if (mode === "comparative") {
    return (
      <div className="flex flex-col gap-5">
        <ComparativeView defaultTab={tabs[0] ?? "Overall"} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Time Breakdown */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Time Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 180 }}>Subject</th>
                <th style={thStyle}>Time Spent</th>
                <th style={thStyle}>Qs Attempted</th>
                <th style={thStyle}>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {timeData.breakdown.map((row) => {
                const pct = row.accuracy;
                const theme = getSubjectTheme(row.subject);
                return (
                  <tr key={row.subject}>
                    <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border"
                          style={{
                            backgroundColor: theme.softBgStrong,
                            borderColor: theme.softBorder,
                            color: theme.color,
                          }}
                        >
                          <SubjectSectionIcon label={row.subject} className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-semibold text-gray-800">{row.subject}</span>
                      </div>
                    </td>
                    <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                      <span className="text-sm font-bold text-gray-900">{row.timeSpent}</span>
                      <span className="text-xs text-gray-400 ml-1">mins</span>
                    </td>
                    <td style={{ border: CELL_BORDER, padding: "14px 20px" }}>
                      <span className="text-sm font-bold text-gray-900">{row.qsAttempted}</span>
                      <span className="text-xs text-gray-400 ml-1">/{row.totalQs} Qs</span>
                    </td>
                    <td style={{ border: CELL_BORDER, padding: 0, minWidth: 140 }}>
                      <div className="relative flex items-center overflow-hidden" style={{ padding: "14px 20px", minHeight: 52 }}>
                        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: theme.softBg }} />
                        <div className="absolute inset-y-0" style={{ left: `${pct}%`, width: "2.5px", background: theme.color, transform: "translateX(-100%)" }} />
                        <span className="relative z-10 text-sm font-bold text-gray-900">{row.accuracy}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Subject-wise */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Subject-wise</h3>
          <div className="flex items-center gap-2 pb-3" style={{ borderBottom: CELL_BORDER }}>
            {subjectWiseTabs.map((tab) => {
              const active = swTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSwTab(tab)}
                  className="flex items-center gap-1.5 text-sm font-medium transition-all"
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: active ? "1.5px solid #d1d5db" : "1.5px solid transparent",
                    background: active ? "#fff" : "transparent",
                    color: active ? "#111827" : "#9ca3af",
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  {tab === "Time Spent" && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/></svg>}
                  {tab === "Questions Attempted" && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></svg>}
                  {tab === "Accuracy" && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-5 mb-3">
            {swChartData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ background: d.color }} />
                <span className="text-xs text-gray-600">{d.name}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={swChartData} margin={{ top: 16, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} ${swChartData[0]?.unit ?? ""}`} />
              <Tooltip formatter={(v) => [`${v} ${swChartData[0]?.unit ?? ""}`, swTab]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64}
                label={{ position: "top", fontSize: 11, fill: "#374151" }}>
                {swChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quality of Time Spent */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px 0" }}>
          <h3 className="text-base font-bold text-gray-900 mb-3">Quality of Time Spent</h3>
          <div className="flex items-center gap-1 pb-3" style={{ borderBottom: CELL_BORDER }}>
            {qualTabKeys.map((tab) => {
              const isActive = qualTab === tab;
              const color = subjectColor(tab);
              return (
                <button
                  key={tab}
                  onClick={() => setQualTab(tab)}
                  className="flex items-center gap-1.5 text-sm font-medium transition-all"
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    marginBottom: -1,
                    borderBottom: isActive ? `2px solid ${color}` : `1.5px solid transparent`,
                    color: isActive ? color : "#6b7280",
                    background: isActive ? `${color}0d` : "transparent",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-5 mb-4 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-gray-700">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
              Time on Correct Qs: <strong>{qual.correct} mins</strong>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-700">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              Time on Incorrect Qs: <strong>{qual.incorrect} mins</strong>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-700">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
              Time on Unattempted Qs: <strong>{qual.unattempted} mins</strong>
            </span>
          </div>
          <div className="flex rounded overflow-hidden h-11 mb-2">
            <div className="flex items-center justify-center text-white text-sm font-bold" style={{ width: `${qual.correctPct}%`, background: "#22c55e" }}>
              {qual.correctPct > 8 ? `${qual.correctPct}%` : ""}
            </div>
            {qual.incorrectPct > 0 && (
              <div className="flex items-center justify-center text-white text-sm font-bold" style={{ width: `${qual.incorrectPct}%`, background: "#ef4444", minWidth: 4 }}>
                {qual.incorrectPct > 5 ? `${qual.incorrectPct}%` : ""}
              </div>
            )}
            <div className="flex items-center justify-center text-white text-sm font-bold" style={{ width: `${qual.unattemptedPct}%`, background: "#475569" }}>
              {qual.unattemptedPct > 5 ? `${qual.unattemptedPct}%` : ""}
            </div>
          </div>
          <p className="text-sm text-gray-700">Overall Time: <strong>{qual.total} mins</strong></p>
        </div>
      </div>

      {/* Time Journey Table */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Time Journey</h3>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Subject</th>
                <th style={{ ...thStyle, color: "#22c55e" }}>Correct Attempts</th>
                <th style={{ ...thStyle, color: "#ef4444" }}>Incorrect Attempts</th>
                <th style={thStyle}>Overall</th>
              </tr>
            </thead>
            <tbody>
              {timeData.journey.map((row) => (
                <tr key={row.interval}>
                  <td style={{ border: CELL_BORDER, padding: "12px 20px" }}>
                    <span className="text-sm font-medium text-gray-700">{row.interval}</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "12px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.correct}</span>
                    <span className="text-xs text-gray-400 ml-1">Qs</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "12px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.incorrect}</span>
                    <span className="text-xs text-gray-400 ml-1">Qs</span>
                  </td>
                  <td style={{ border: CELL_BORDER, padding: "12px 20px" }}>
                    <span className="text-sm font-bold text-gray-900">{row.overall}</span>
                    <span className="text-xs text-gray-400 ml-1">Qs</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Graphical View of Attempts */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: CELL_BORDER, borderTop: "3px solid #111827" }}>
        <div style={{ padding: "16px 24px", borderBottom: CELL_BORDER }}>
          <h3 className="text-base font-bold text-gray-900">Graphical View of Attempts Over {timeData.attemptWindowLabel}</h3>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-5 mb-4">
            {LINE_SERIES.map((s) => (
              <button
                key={s.key}
                onClick={() => toggleLine(s.key)}
                className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 transition-colors"
              >
                <span
                  className="w-4 h-4 rounded-sm inline-flex items-center justify-center border-2 transition-colors"
                  style={{ borderColor: s.color, background: lineChecked[s.key] ? s.color : "white" }}
                >
                  {lineChecked[s.key] && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
                    </svg>
                  )}
                </span>
                {s.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeData.graphicalAttempts} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v} Qs`} />
              <Tooltip />
              {LINE_SERIES.map((s) =>
                lineChecked[s.key] ? (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
