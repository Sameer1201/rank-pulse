import { useState, useCallback, useRef, useEffect } from "react";
import { parseQuestionsFromHTML, type ParsedQuestion } from "@/lib/questionParser";
import QuestionMetaTable, { type QuestionMeta } from "@/components/admin/QuestionMetaTable";
import AiApiKeysPanel from "@/components/admin/AiApiKeysPanel";
import { buildApiUrl } from "@/lib/api-origin";

interface TestOption {
  id: number;
  title: string;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  );
}

interface FileEntry {
  name: string;
  questionCount: number;
  questions: ParsedQuestion[];
  title: string | null;
}

interface Session {
  id: string;
  name: string;
  testTitle: string | null;
  fileNames: string[];
  questionCount: number;
  rows: QuestionMeta[];
  updatedAt: string;
}

type Step = "upload" | "analyzing" | "table";

// ── Approve Modal ────────────────────────────────────────────────────────────
function ApproveModal({
  open,
  onClose,
  rows,
  tests,
  label,
}: {
  open: boolean;
  onClose: () => void;
  rows: QuestionMeta[];
  tests: TestOption[];
  label?: string;
}) {
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<string | null>(null);

  // reset on open
  useEffect(() => {
    if (open) {
      setSelectedTestId(null);
      setApproveError(null);
      setApproveSuccess(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!selectedTestId || rows.length === 0) return;
    setIsApproving(true);
    setApproveError(null);
    try {
      const r = await fetch(buildApiUrl(`/api/tests/${selectedTestId}/import-question-metadata`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const data = await r.json() as { updatedCount?: number; skippedCount?: number };
      const testName = tests.find((t) => t.id === selectedTestId)?.title ?? "Test";
      setApproveSuccess(`✓ ${data.updatedCount ?? 0} questions ka metadata "${testName}" mein apply ho gaya!`);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Apply karne mein error aaya.");
    } finally {
      setIsApproving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              {label ? `Approve & Apply — ${label}` : "Approve & Apply to Test"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[#F1F5F9] text-[#94A3B8] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {approveSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-semibold text-[#0F172A]">{approveSuccess}</p>
              <button
                onClick={onClose}
                className="mt-1 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-sm font-medium text-[#374151]">Kaunse test mein apply karna hai?</p>
                <select
                  value={selectedTestId ?? ""}
                  onChange={(e) => setSelectedTestId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#0F172A] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                >
                  <option value="">— Test select karo —</option>
                  {tests.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
                {tests.length === 0 && (
                  <p className="mt-1.5 text-xs text-[#94A3B8]">Koi test nahi mila. Pehle ek test create karo.</p>
                )}
              </div>

              <div className="rounded-xl border border-[#F1F5F9] bg-[#F8FAFC] px-4 py-3">
                <p className="text-xs text-[#64748B]">
                  <span className="font-semibold text-[#0F172A]">{rows.length} questions</span> ka metadata apply hoga — Subject, Chapter, Topic, Difficulty aur Ideal Time.
                </p>
              </div>

              {approveError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {approveError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F8FAFC] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!selectedTestId || isApproving}
                  className="flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isApproving ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
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
                      Approve & Apply
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuestionMetadata() {
  const [isDragging, setIsDragging] = useState(false);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);
  const [testTitle, setTestTitle] = useState<string | null>(null);
  const [metaRows, setMetaRows] = useState<QuestionMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Approve modal state
  const [tests, setTests] = useState<TestOption[]>([]);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approvePendingRows, setApprovePendingRows] = useState<QuestionMeta[]>([]);
  const [approveLabel, setApproveLabel] = useState<string | undefined>(undefined);

  // Bulk approve state (checkboxes in table)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);

  useEffect(() => {
    fetch(buildApiUrl(`/api/tests`), { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ id: number; title: string }>) =>
        setTests(data.map((t) => ({ id: t.id, title: t.title })))
      )
      .catch(() => {});
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/meta-sessions`), { credentials: "include" });
      if (res.ok) setSessions(await res.json());
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Load sessions on mount
  useEffect(() => { void loadSessions(); }, []);

  const saveSession = useCallback(async (id: string, rows: QuestionMeta[], files: FileEntry[], title: string | null) => {
    setIsSaving(true);
    try {
      await fetch(buildApiUrl(`/api/meta-sessions`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id,
          name: title || files[0]?.name || "Untitled Session",
          testTitle: title,
          fileNames: files.map((f) => f.name),
          questionCount: rows.length,
          rows,
        }),
      });
      await loadSessions();
    } finally {
      setIsSaving(false);
    }
  }, [loadSessions]);

  const autoSave = useCallback((id: string, rows: QuestionMeta[], files: FileEntry[], title: string | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSession(id, rows, files, title);
    }, 1500);
  }, [saveSession]);

  const handleMetaChange = useCallback((rows: QuestionMeta[]) => {
    setMetaRows(rows);
    if (activeSessionId) autoSave(activeSessionId, rows, fileEntries, testTitle);
  }, [activeSessionId, fileEntries, testTitle, autoSave]);

  const processFiles = useCallback(async (files: File[]) => {
    const htmlFiles = files.filter((f) => f.name.endsWith(".html") || f.name.endsWith(".htm"));
    if (htmlFiles.length === 0) { setError("Sirf HTML files supported hain."); return; }
    setError(null);
    const entries: FileEntry[] = [];
    for (const file of htmlFiles) {
      const text = await file.text();
      const { questions, testTitle: title } = parseQuestionsFromHTML(text);
      entries.push({ name: file.name, questionCount: questions.length, questions, title });
    }
    const allQuestions = entries.flatMap((e) => e.questions);
    if (allQuestions.length === 0) { setError("Files mein koi question nahi mila."); return; }

    setFileEntries(entries);
    setParsedQuestions(allQuestions);
    const title = entries.length === 1 ? entries[0].title : null;
    setTestTitle(title);
    setStep("analyzing");

    const BATCH = 10;
    const total = allQuestions.length;
    setProgress({ done: 0, total });
    const allMeta: QuestionMeta[] = [];

    try {
      for (let i = 0; i < allQuestions.length; i += BATCH) {
        const batch = allQuestions.slice(i, i + BATCH);
        const res = await fetch(buildApiUrl(`/api/metadata/analyze`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ questions: batch, testTitle: title }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as QuestionMeta[];
        allMeta.push(...data);
        setProgress({ done: Math.min(i + BATCH, total), total });
      }

      setMetaRows(allMeta);
      setStep("table");

      const sessionId = generateId();
      setActiveSessionId(sessionId);
      await saveSession(sessionId, allMeta, entries, title);
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)));
      setStep("upload");
    }
  }, [saveSession]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(Array.from(e.dataTransfer.files));
  };

  const handleReset = () => {
    setStep("upload");
    setFileEntries([]);
    setParsedQuestions([]);
    setMetaRows([]);
    setActiveSessionId(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    loadSessions();
  };

  const handleRestore = (s: Session) => {
    setMetaRows(s.rows);
    setTestTitle(s.testTitle);
    setFileEntries(s.fileNames.map((name) => ({ name, questionCount: 0, questions: [], title: s.testTitle })));
    setActiveSessionId(s.id);
    setStep("table");
  };

  const handleDeleteSession = async (id: string) => {
    await fetch(buildApiUrl(`/api/meta-sessions/${id}`), { method: "DELETE", credentials: "include" });
    setSelectedSessionIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await loadSessions();
  };

  const handleRename = async (id: string, name: string) => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    await fetch(buildApiUrl(`/api/meta-sessions/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...session, name }),
    });
    await loadSessions();
  };

  // ── Individual approve from table ────────────────────────────────────────
  const openIndividualApprove = (s: Session) => {
    setApprovePendingRows(s.rows);
    setApproveLabel(s.name);
    setApproveOpen(true);
  };

  // ── Approve from table view (existing session open) ──────────────────────
  const handleApprove = useCallback((rows: QuestionMeta[]) => {
    setApprovePendingRows(rows);
    setApproveLabel(undefined);
    setApproveOpen(true);
  }, []);

  // ── Bulk approve ─────────────────────────────────────────────────────────
  const openBulkApprove = () => {
    const selected = sessions.filter((s) => selectedSessionIds.has(s.id));
    const combined: QuestionMeta[] = selected.flatMap((s) => s.rows);
    setApprovePendingRows(combined);
    setApproveLabel(`${selected.length} sessions (${combined.length} questions)`);
    setBulkApproveOpen(true);
  };

  const toggleSessionSelect = (id: string) => {
    setSelectedSessionIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSessionIds.size === sessions.length && sessions.length > 0) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(sessions.map((s) => s.id)));
    }
  };

  const allSelected = sessions.length > 0 && selectedSessionIds.size === sessions.length;
  const someSelected = selectedSessionIds.size > 0 && !allSelected;

  // ── Table view ──────────────────────────────────────────────────────────────
  if (step === "table") {
    return (
      <div className="flex h-full flex-col">
        <QuestionMetaTable
          rows={metaRows}
          onChange={handleMetaChange}
          testTitle={testTitle}
          fileNames={fileEntries.map((f) => f.name)}
          sessionId={activeSessionId}
          isSaving={isSaving}
          onReset={handleReset}
          onRename={handleRename}
          onApprove={handleApprove}
          isApproving={false}
        />

        <ApproveModal
          open={approveOpen}
          onClose={() => setApproveOpen(false)}
          rows={approvePendingRows}
          tests={tests}
          label={approveLabel}
        />
      </div>
    );
  }

  // ── Analyzing view ──────────────────────────────────────────────────────────
  if (step === "analyzing") {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EFF6FF]">
          <span className="text-3xl animate-spin">⚙️</span>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-[#0F172A]">AI Analysis chal rahi hai…</p>
          <p className="mt-1 text-sm text-[#64748B]">{progress.done} / {progress.total} questions classify ho gaye</p>
        </div>
        <div className="w-full max-w-sm">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className="h-full rounded-full bg-[#2563EB] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-[#94A3B8]">{pct}% complete</p>
        </div>
      </div>
    );
  }

  // ── Upload view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Question Metadata Generator</h1>
        <p className="mt-1 text-sm text-[#64748B]">HTML question paper upload karo — AI har question ka subject, chapter, topic aur difficulty auto-tag karega.</p>
      </div>

      {/* AI Keys */}
      <AiApiKeysPanel />

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 transition-colors ${
          isDragging ? "border-[#2563EB] bg-[#EFF6FF]" : "border-[#E5E7EB] bg-white hover:border-[#2563EB] hover:bg-[#F8FAFC]"
        }`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EFF6FF]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-[#0F172A]">HTML file yahan drop karo</p>
          <p className="mt-1 text-sm text-[#64748B]">ya click karke select karo</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Saved Sessions Table ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[#0F172A]">📂 Saved Sessions</span>
            {sessions.length > 0 && (
              <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium text-[#64748B]">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedSessionIds.size > 0 && (
              <button
                onClick={openBulkApprove}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Approve Selected ({selectedSessionIds.size})
              </button>
            )}
            <button
              onClick={loadSessions}
              className="rounded-lg p-1.5 hover:bg-[#F1F5F9] text-[#94A3B8] transition-colors"
              title="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Table */}
        {sessionsLoading ? (
          <p className="py-8 text-center text-sm text-[#94A3B8]">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#94A3B8]">Koi saved session nahi hai abhi tak.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
                  {/* Select all checkbox */}
                  <th className="w-10 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-[#D1D5DB] accent-[#2563EB] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wide">Session Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wide">Questions</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wide hidden md:table-cell">Files</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wide hidden lg:table-cell">Updated</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#64748B] uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {sessions.map((s) => {
                  const isSelected = selectedSessionIds.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      className={`group transition-colors hover:bg-[#F8FAFC] ${isSelected ? "bg-blue-50/50" : ""}`}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSessionSelect(s.id)}
                          className="h-4 w-4 rounded border-[#D1D5DB] accent-[#2563EB] cursor-pointer"
                        />
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[#0F172A]">{s.name}</p>
                            {s.testTitle && s.testTitle !== s.name && (
                              <p className="truncate text-xs text-[#94A3B8]">{s.testTitle}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Questions count */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-semibold text-[#2563EB]">
                          {s.questionCount}
                        </span>
                      </td>

                      {/* Files */}
                      <td className="px-4 py-3 hidden md:table-cell max-w-[180px]">
                        <p className="truncate text-xs text-[#64748B]" title={s.fileNames.join(", ")}>
                          {s.fileNames.length === 0 ? "—" : s.fileNames.join(", ")}
                        </p>
                      </td>

                      {/* Updated */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <p className="whitespace-nowrap text-xs text-[#94A3B8]">{formatDate(s.updatedAt)}</p>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Approve (individual) */}
                          <button
                            onClick={() => openIndividualApprove(s)}
                            className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                            title="Approve & Apply to Test"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Approve
                          </button>

                          {/* Open */}
                          <button
                            onClick={() => handleRestore(s)}
                            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#374151] hover:bg-[#F8FAFC] transition-colors"
                            title="Open session"
                          >
                            Open
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteSession(s.id)}
                            className="rounded-lg p-1.5 hover:bg-red-50 hover:text-red-500 text-[#94A3B8] transition-colors"
                            title="Delete"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                              <path d="M10 11v6"/><path d="M14 11v6"/>
                              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Bulk approve footer bar */}
            {selectedSessionIds.size > 0 && (
              <div className="flex items-center justify-between border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-3">
                <p className="text-sm text-[#374151]">
                  <span className="font-semibold text-[#0F172A]">{selectedSessionIds.size}</span> session{selectedSessionIds.size !== 1 ? "s" : ""} selected
                  {" "}·{" "}
                  <span className="font-semibold text-[#0F172A]">
                    {sessions.filter((s) => selectedSessionIds.has(s.id)).reduce((sum, s) => sum + s.questionCount, 0)}
                  </span> questions total
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedSessionIds(new Set())}
                    className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#374151] hover:bg-white transition-colors"
                  >
                    Deselect All
                  </button>
                  <button
                    onClick={openBulkApprove}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Approve All Selected
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Approve modal — individual */}
      <ApproveModal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        rows={approvePendingRows}
        tests={tests}
        label={approveLabel}
      />

      {/* Approve modal — bulk */}
      <ApproveModal
        open={bulkApproveOpen}
        onClose={() => setBulkApproveOpen(false)}
        rows={approvePendingRows}
        tests={tests}
        label={approveLabel}
      />
    </div>
  );
}
