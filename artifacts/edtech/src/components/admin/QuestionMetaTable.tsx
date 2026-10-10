import { useState, useCallback } from "react";

export interface QuestionMeta {
  questionCode: string;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: "easy" | "moderate" | "hard";
  idealTimeSeconds: number;
}

interface Props {
  rows: QuestionMeta[];
  onChange: (rows: QuestionMeta[]) => void;
  testTitle: string | null;
  fileNames: string[];
  sessionId: string | null;
  isSaving: boolean;
  onReset: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onApprove?: (rows: QuestionMeta[]) => void;
  isApproving?: boolean;
}

const DIFFICULTY_OPTIONS = ["easy", "moderate", "hard"] as const;

function CellInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2563EB]/30 hover:bg-[#F8FAFC] transition-colors"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DifficultySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const colors: Record<string, string> = {
    easy: "text-green-600 bg-green-50",
    moderate: "text-yellow-600 bg-yellow-50",
    hard: "text-red-600 bg-red-50",
  };
  return (
    <select
      className={`rounded border border-transparent px-1 py-0.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2563EB]/30 ${colors[value] || ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {DIFFICULTY_OPTIONS.map((d) => (
        <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
      ))}
    </select>
  );
}

function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={10}
      step={10}
      className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2563EB]/30 hover:bg-[#F8FAFC] transition-colors"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 60)}
    />
  );
}

export default function QuestionMetaTable({
  rows, onChange, testTitle, fileNames, sessionId, isSaving, onReset, onRename, onApprove, isApproving,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(testTitle || fileNames[0] || "Untitled Session");
  const [isSavingName, setIsSavingName] = useState(false);

  const updateRow = useCallback(
    (idx: number, field: keyof QuestionMeta, value: string | number) => {
      onChange(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    },
    [rows, onChange]
  );

  const handleNameSave = async () => {
    if (!sessionId || !nameValue.trim()) { setIsEditingName(false); return; }
    setIsSavingName(true);
    await onRename(sessionId, nameValue.trim());
    setIsSavingName(false);
    setIsEditingName(false);
  };

  const jsonOutput = JSON.stringify(
    rows.map((r) => ({
      questionCode: r.questionCode,
      subject: r.subject,
      chapter: r.chapter,
      topic: r.topic,
      difficulty: r.difficulty,
      idealTimeSeconds: r.idealTimeSeconds,
    })),
    null,
    2
  );

  const handleCopyJson = () => {
    navigator.clipboard.writeText(jsonOutput).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonOutput], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nameValue.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white px-5 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onReset}
            className="p-1.5 rounded-lg hover:bg-[#F1F5F9] text-[#64748B] hover:text-[#0F172A] transition-colors"
            title="Back to sessions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") setIsEditingName(false); }}
                className="rounded-lg border border-[#2563EB] px-2 py-1 text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 min-w-[200px]"
              />
              <button onClick={handleNameSave} disabled={isSavingName} className="rounded-lg bg-[#2563EB] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                {isSavingName ? "…" : "Save"}
              </button>
              <button onClick={() => setIsEditingName(false)} className="rounded-lg border border-[#E5E7EB] px-3 py-1 text-xs font-semibold text-[#374151] hover:bg-[#F8FAFC]">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingName(true)}
              className="group flex items-center gap-2 text-sm font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors"
            >
              {nameValue}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 group-hover:opacity-100 transition-opacity"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}

          {isSaving && <span className="text-xs text-[#64748B] animate-pulse">Saving…</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJson((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${showJson ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]" : "border-[#E5E7EB] text-[#374151] hover:bg-[#F8FAFC]"}`}
          >
            {showJson ? "Table View" : "JSON View"}
          </button>
          <button
            onClick={handleCopyJson}
            className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#374151] hover:bg-[#F8FAFC] transition-colors"
          >
            {copied ? "✓ Copied!" : "Copy JSON"}
          </button>
          <button
            onClick={handleDownloadJson}
            className="flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] transition-colors"
          >
            ↓ Download
          </button>
        </div>
      </div>

      {/* File names */}
      {fileNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-[#F8FAFC] border-b border-[#F1F5F9] px-5 py-2">
          <span className="text-xs text-[#94A3B8]">Files:</span>
          {fileNames.map((name) => (
            <span key={name} className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-xs font-medium text-[#374151] truncate max-w-[200px]">{name}</span>
          ))}
        </div>
      )}

      {/* Content */}
      {showJson ? (
        <div className="flex-1 p-5">
          <pre className="h-full overflow-auto rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-5 text-xs font-mono leading-relaxed text-[#0F172A] whitespace-pre-wrap">
            {jsonOutput}
          </pre>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-[#F8FAFC]">
                {["#", "Q Code", "Subject", "Chapter", "Topic", "Difficulty", "Time (sec)"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.questionCode + idx} className="border-b border-[#F1F5F9] hover:bg-[#FAFBFF] transition-colors">
                  <td className="px-4 py-2 text-xs text-[#94A3B8] w-8">{idx + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs font-bold text-[#2563EB] whitespace-nowrap">{row.questionCode}</td>
                  <td className="px-4 py-2 min-w-[160px]"><CellInput value={row.subject} onChange={(v) => updateRow(idx, "subject", v)} /></td>
                  <td className="px-4 py-2 min-w-[180px]"><CellInput value={row.chapter} onChange={(v) => updateRow(idx, "chapter", v)} /></td>
                  <td className="px-4 py-2 min-w-[200px]"><CellInput value={row.topic} onChange={(v) => updateRow(idx, "topic", v)} /></td>
                  <td className="px-4 py-2 min-w-[110px]"><DifficultySelect value={row.difficulty} onChange={(v) => updateRow(idx, "difficulty", v as QuestionMeta["difficulty"])} /></td>
                  <td className="px-4 py-2"><TimeInput value={row.idealTimeSeconds} onChange={(v) => updateRow(idx, "idealTimeSeconds", v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-[#E5E7EB] bg-white px-5 py-3 flex items-center justify-between gap-4">
        <span className="text-xs text-[#64748B]">{rows.length} questions • Click any cell to edit</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="h-2 w-2 rounded-full bg-green-500 inline-block"></span>
            AI analysis complete
          </span>
          {onApprove && (
            <button
              onClick={() => onApprove(rows)}
              disabled={isApproving || rows.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApproving ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Applying…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Approve & Apply to Test
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
