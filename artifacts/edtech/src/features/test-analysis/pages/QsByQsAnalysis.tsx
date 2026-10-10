import { useState, useMemo } from "react";
import { qsByQsData, completeBreakdownData, type QStatus, type QQuality } from "@/data/testData";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { getSubjectTheme } from "@/lib/subject-theme";

function subjectTheme(label: string) {
  return getSubjectTheme(label === "All Subjects" ? "Overall" : label);
}

function subjectColor(label: string) {
  return subjectTheme(label).color;
}

function renderSubjectIcon(label: string, color: string, className = "w-5 h-5") {
  return (
    <span className="inline-flex" style={{ color }}>
      <SubjectSectionIcon label={label === "All Subjects" ? "Overall" : label} className={className} />
    </span>
  );
}

function StatusIcon({ status }: { status: QStatus }) {
  if (status === "correct") {
    return (
      <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
      </svg>
    );
  }
  if (status === "wrong") {
    return (
      <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
      </svg>
    );
  }
  if (status === "notVisited") {
    return (
      <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="10" cy="10" r="7" strokeDasharray="3 2" />
      </svg>
    );
  }
  if (status === "notAnswered") {
    return (
      <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="10" cy="10" r="7" />
        <path strokeLinecap="round" d="M10 7v3M10 13h.01" strokeWidth={2.5} />
      </svg>
    );
  }
  if (status === "markedReview") {
    return (
      <svg className="w-3 h-3.5 text-indigo-500" viewBox="0 0 14 18" fill="currentColor">
        <path d="M0 0h14v18l-7-4-7 4V0z" />
      </svg>
    );
  }
  return null;
}

function QualityIcon({ quality }: { quality: QQuality }) {
  if (quality === "perfect") {
    return (
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-green-500">
        <svg className="w-2 h-2 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
        </svg>
      </span>
    );
  }
  if (quality === "wasted") {
    return (
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-red-500">
        <svg className="w-2 h-2 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
        </svg>
      </span>
    );
  }
  if (quality === "overtime") {
    return (
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-orange-500">
        <svg className="w-2 h-2 text-orange-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="10" cy="10" r="7" />
          <path strokeLinecap="round" d="M10 6v4l2 2" />
        </svg>
      </span>
    );
  }
  if (quality === "confused") {
    return (
      <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-indigo-500">
        <svg className="w-2 h-2 text-indigo-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="10" cy="10" r="7" />
          <path strokeLinecap="round" d="M7 8c0-1.657 1.343-3 3-3s3 1.343 3 3c0 2-3 2-3 4" />
          <circle cx="10" cy="15" r="0.5" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return <span className="w-3.5 h-3.5" />;
}

function QuestionBubble({
  no,
  status,
  quality,
  showQuality,
}: {
  no: number;
  status: QStatus;
  quality: QQuality;
  showQuality: boolean;
}) {
  return (
    <div className="flex flex-col items-center w-10">
      <div className="w-9 h-9 rounded-xl border border-gray-300 bg-white flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm">
        {no}
      </div>
      <div className="mt-1 h-4 flex items-center justify-center">
        {showQuality ? <QualityIcon quality={quality} /> : <StatusIcon status={status} />}
      </div>
    </div>
  );
}

type SortKey = "qNo" | "timeSpent";
type SortDir = "asc" | "desc";

function parseTime(t: string): number {
  const m = t.match(/(\d+)\s*min\s*(\d+)\s*sec/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
}

export default function QsByQsAnalysis() {
  const tabs = useMemo(() => ["All Subjects", ...qsByQsData.map((subject) => subject.name)], [qsByQsData]);
  const tabColors = useMemo(
    () =>
      tabs.reduce<Record<string, string>>((acc, tab) => {
        acc[tab] = subjectColor(tab === "All Subjects" ? "Overall" : tab);
        return acc;
      }, {}),
    [tabs, qsByQsData],
  );
  const filterOptions = useMemo(
    () => ({
      subject: ["All", ...Array.from(new Set(completeBreakdownData.map((row) => row.subject)))],
      difficulty: ["All", "Easy", "Moderate", "Tough"],
      status: ["All", "Answered", "Not Attempted"],
      evaluation: ["All", "correct", "wrong", "notAttempted"],
      overview: ["All", "Perfect", "Overtime", "—"],
    }),
    [completeBreakdownData],
  );
  const [activeTab, setActiveTab] = useState("All Subjects");
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(false);

  // Complete Breakdown state
  const [sortKey, setSortKey] = useState<SortKey>("qNo");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filters, setFilters] = useState({ subject: "All", difficulty: "All", status: "All", evaluation: "All", overview: "All" });
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (col: string, val: string) => {
    setFilters((f) => ({ ...f, [col]: val }));
    setOpenFilter(null);
  };

  const filteredRows = useMemo(() => {
    let rows = [...completeBreakdownData];
    if (filters.subject !== "All")    rows = rows.filter((r) => r.subject === filters.subject);
    if (filters.difficulty !== "All") rows = rows.filter((r) => r.difficulty === filters.difficulty);
    if (filters.status !== "All")     rows = rows.filter((r) => r.status === filters.status);
    if (filters.evaluation !== "All") rows = rows.filter((r) => r.evaluation === filters.evaluation);
    if (filters.overview !== "All") {
      if (filters.overview === "—") rows = rows.filter((r) => !r.overview);
      else rows = rows.filter((r) => r.overview === filters.overview);
    }
    rows.sort((a, b) => {
      const v = sortKey === "qNo"
        ? a.qNo - b.qNo
        : parseTime(a.timeSpent) - parseTime(b.timeSpent);
      return sortDir === "asc" ? v : -v;
    });
    return rows;
  }, [filters, sortKey, sortDir]);

  const visibleSubjects =
    activeTab === "All Subjects"
      ? qsByQsData
      : qsByQsData.filter((s) => s.name === activeTab);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5" style={{ borderTop: "3px solid #111827" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">All Question Analysis</h2>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-sm text-gray-600">Show Quality of Attempt</span>
            <button
              role="switch"
              aria-checked={showQuality}
              onClick={() => setShowQuality((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                showQuality ? "bg-indigo-500" : "bg-gray-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  showQuality ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </label>
        </div>

        <div className="mb-4 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none]">
          <div className="flex min-w-max gap-1 border-b border-gray-200">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const isHovered = hoveredTab === tab && !isActive;
              const color = tabColors[tab] || "#6366f1";
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  onMouseEnter={() => setHoveredTab(tab)}
                  onMouseLeave={() => setHoveredTab(null)}
                  className="flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-all"
                  style={{
                    borderRadius: 6,
                    marginBottom: -1,
                    border: isActive ? `2px solid transparent` : isHovered ? `1.5px solid ${color}` : `1.5px solid transparent`,
                    borderBottom: isActive ? `2px solid ${color}` : isHovered ? `1.5px solid ${color}` : `1.5px solid transparent`,
                    color: isActive || isHovered ? color : "#6b7280",
                    background: isActive ? `${color}0d` : isHovered ? `${color}08` : "transparent",
                  }}
                >
                  {renderSubjectIcon(tab, isActive || isHovered ? color : "#9ca3af", "w-4 h-4")}
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500 border-b border-gray-100 pb-4 mb-5">
          {!showQuality ? (
            <>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" /></svg>
                Correct
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" /></svg>
                Wrong
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="10" cy="10" r="7" strokeDasharray="3 2" /></svg>
                Not Visited
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="10" cy="10" r="7" /><path strokeLinecap="round" d="M10 7v3M10 13h.01" strokeWidth={2.5} /></svg>
                Not Answered
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3 h-3.5 text-indigo-500" viewBox="0 0 14 18" fill="currentColor"><path d="M0 0h14v18l-7-4-7 4V0z" /></svg>
                Marked for Review
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-green-500">
                  <svg className="w-2 h-2 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" /></svg>
                </span>
                Perfect
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-red-500">
                  <svg className="w-2 h-2 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" /></svg>
                </span>
                Wasted
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-orange-500">
                  <svg className="w-2 h-2 text-orange-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="10" cy="10" r="7" /><path strokeLinecap="round" d="M10 6v4l2 2" /></svg>
                </span>
                Overtime
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border-2 border-indigo-500">
                  <svg className="w-2 h-2 text-indigo-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="10" cy="10" r="7" /><path strokeLinecap="round" d="M7 8c0-1.657 1.343-3 3-3s3 1.343 3 3c0 2-3 2-3 4" /><circle cx="10" cy="15" r="0.5" fill="currentColor" /></svg>
                </span>
                Confused
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3 h-3.5 text-indigo-500" viewBox="0 0 14 18" fill="currentColor"><path d="M0 0h14v18l-7-4-7 4V0z" /></svg>
                Marked for Review
              </span>
            </>
          )}
        </div>

        <div className="space-y-8">
          {visibleSubjects.map((subject) => {
            const theme = subjectTheme(subject.name);

            return (
              <div key={subject.name}>
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border"
                    style={{
                      backgroundColor: theme.softBgStrong,
                      borderColor: theme.softBorder,
                      color: theme.color,
                    }}
                  >
                    <SubjectSectionIcon label={subject.name} className="h-5 w-5" />
                  </span>
                  <span className="text-base font-semibold" style={{ color: theme.color }}>
                    {subject.name}
                  </span>
                </div>
                <div className="space-y-5">
                  {subject.sections.map((section) => (
                    <div key={section.label}>
                      <p className="text-xs text-gray-400 font-medium mb-3">{section.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {section.questions.map((q) => (
                          <QuestionBubble
                            key={q.no}
                            no={q.no}
                            status={q.status}
                            quality={q.quality}
                            showQuality={showQuality}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Complete Breakdown */}
      <div
        className="bg-white rounded-xl overflow-visible"
        style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #111827" }}
        onClick={() => openFilter && setOpenFilter(null)}
      >
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb" }}>
          <h2 className="text-base font-bold text-gray-900">Complete Breakdown</h2>
          <p className="text-xs text-gray-400 mt-0.5">This table lists all the questions and your performance of each question. You can click on any row to view the question.</p>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {/* Qs No — sortable */}
                <th style={{ border: "1px solid #e5e7eb", padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#6b7280", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", width: 70 }}
                  onClick={() => handleSort("qNo")}>
                  <span className="flex items-center gap-1">
                    Qs No
                    <span className="flex flex-col" style={{ lineHeight: 1 }}>
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 6" fill={sortKey === "qNo" && sortDir === "asc" ? "#6366f1" : "#d1d5db"}><path d="M5 0l5 6H0z"/></svg>
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 6" fill={sortKey === "qNo" && sortDir === "desc" ? "#6366f1" : "#d1d5db"}><path d="M5 6l5-6H0z"/></svg>
                    </span>
                  </span>
                </th>
                <FilterHeader col="subject" label="Subject" width={190} minWidth={190} openFilter={openFilter} setOpenFilter={setOpenFilter} filters={filters} setFilter={setFilter} opts={filterOptions.subject} />
                <th style={{ border: "1px solid #e5e7eb", padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Chapter</th>
                <th style={{ border: "1px solid #e5e7eb", padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Topic</th>
                <FilterHeader col="difficulty" label="Difficulty" openFilter={openFilter} setOpenFilter={setOpenFilter} filters={filters} setFilter={setFilter} opts={filterOptions.difficulty} />
                {/* Time Spent — sortable */}
                <th style={{ border: "1px solid #e5e7eb", padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#6b7280", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                  onClick={() => handleSort("timeSpent")}>
                  <span className="flex items-center gap-1">
                    Time Spent
                    <span className="flex flex-col" style={{ lineHeight: 1 }}>
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 6" fill={sortKey === "timeSpent" && sortDir === "asc" ? "#6366f1" : "#d1d5db"}><path d="M5 0l5 6H0z"/></svg>
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 6" fill={sortKey === "timeSpent" && sortDir === "desc" ? "#6366f1" : "#d1d5db"}><path d="M5 6l5-6H0z"/></svg>
                    </span>
                  </span>
                </th>
                <FilterHeader col="status"     label="Status"     openFilter={openFilter} setOpenFilter={setOpenFilter} filters={filters} setFilter={setFilter} opts={filterOptions.status} />
                <FilterHeader col="evaluation" label="Evaluation"  openFilter={openFilter} setOpenFilter={setOpenFilter} filters={filters} setFilter={setFilter} opts={filterOptions.evaluation} />
                <FilterHeader col="overview"   label="Overview"    openFilter={openFilter} setOpenFilter={setOpenFilter} filters={filters} setFilter={setFilter} opts={filterOptions.overview} />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.qNo} className="hover:bg-gray-50 transition-colors cursor-pointer">
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", textAlign: "center", fontSize: 13, color: "#374151", fontWeight: 500 }}>{row.qNo}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", fontSize: 13, color: "#374151", minWidth: 190 }}>
                    {(() => {
                      const theme = subjectTheme(row.subject);
                      return (
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border"
                            style={{
                              backgroundColor: theme.softBgStrong,
                              borderColor: theme.softBorder,
                              color: theme.color,
                            }}
                          >
                            <SubjectSectionIcon label={row.subject} className="h-3.5 w-3.5" />
                          </span>
                          {row.subject}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", fontSize: 13, color: "#374151" }}>{row.chapter}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", fontSize: 13, color: "#374151" }}>{row.topic}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", textAlign: "center" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                      background: row.difficulty === "Easy" ? "#dcfce7" : row.difficulty === "Moderate" ? "#ffedd5" : "#fee2e2",
                      color: row.difficulty === "Easy" ? "#16a34a" : row.difficulty === "Moderate" ? "#ea580c" : "#dc2626",
                    }}>{row.difficulty}</span>
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>{row.timeSpent}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", fontSize: 13, color: "#374151" }}>{row.status}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", textAlign: "center" }}>
                    {row.evaluation === "correct"
                      ? <svg className="w-4 h-4 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12l5 5 11-11" /></svg>
                      : row.evaluation === "wrong"
                      ? <svg className="w-4 h-4 text-red-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" /></svg>
                      : <span className="text-gray-300 text-sm">—</span>}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: "12px 16px", textAlign: "center" }}>
                    {row.overview
                      ? <span style={{ fontSize: 12, fontWeight: 600, color: row.overview === "Perfect" ? "#16a34a" : row.overview === "Overtime" ? "#f97316" : "#6b7280" }}>{row.overview}</span>
                      : <span className="text-gray-300 text-sm">—</span>}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-gray-400 text-sm py-8">No questions match the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterHeader({ col, label, width, minWidth, openFilter, setOpenFilter, filters, setFilter, opts }: {
  col: string; label: string;
  width?: number; minWidth?: number;
  openFilter: string | null; setOpenFilter: (v: string | null) => void;
  filters: Record<string, string>; setFilter: (col: string, val: string) => void;
  opts: string[];
}) {
  const isActive = filters[col] !== "All";
  return (
    <th style={{ border: "1px solid #e5e7eb", padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#6b7280", position: "relative", whiteSpace: "nowrap", width, minWidth }}>
      <button
        className="flex items-center gap-1 hover:text-gray-900 transition-colors"
        style={{ color: isActive ? "#6366f1" : undefined, fontWeight: isActive ? 700 : undefined }}
        onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === col ? null : col); }}
      >
        {label}
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill={isActive ? "#6366f1" : "#9ca3af"}>
          <path fillRule="evenodd" d="M3 3h14l-5.5 7V17l-3-1.5V10L3 3z" clipRule="evenodd" />
        </svg>
      </button>
      {openFilter === col && (
        <div
          className="absolute z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-max"
          style={{ top: "100%", left: 0, marginTop: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          {opts.map((opt) => (
            <button
              key={opt}
              onClick={() => setFilter(col, opt)}
              className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
              style={{ color: filters[col] === opt ? "#6366f1" : "#374151", fontWeight: filters[col] === opt ? 600 : 400 }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </th>
  );
}
