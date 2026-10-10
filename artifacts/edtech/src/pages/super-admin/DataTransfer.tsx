import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Download, Upload, Database, CheckCircle2, AlertTriangle,
  RefreshCw, FileJson, ShieldAlert, BarChart3, Users,
  BookOpen, ClipboardList, Activity, Bell, MessageSquare,
  Mail, Calendar, FileText, Key, Lock, Send,
  HardDrive, TrendingUp, Eye, Loader2, XCircle,
  Table2, FileSpreadsheet, ChevronDown, ChevronUp, Info, IndianRupee,
  Pencil, Trash2, Save, X as XIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { buildApiUrl } from "@/lib/api-origin";

interface Counts {
  users: number; subjects: number;
  chapters: number; tests: number; testSections: number;
  testQuestions: number; testSubmissions: number;
  questionBankQuestions: number;
  questionBankProgress: number; questionBankSaved: number;
  activityLogs: number; sessions: number; notifications: number;
  directMessages: number; emailSendLogs: number;
  emailProviderDailyUsage: number; testQuestionReports: number;
  passwordResetRequests: number; paymentHistory: number;
}

interface ImportResult {
  success: boolean;
  summary: { totalInserted: number; totalSkipped: number };
  details: Record<string, { inserted: number; skipped: number }>;
}

interface ProgressEvent {
  type: "start" | "done" | "complete" | "error";
  key?: string;
  label?: string;
  inserted?: number;
  skipped?: number;
  lastError?: string;
  done?: number;
  totalSteps?: number;
  summary?: { totalInserted: number; totalSkipped: number };
  details?: Record<string, { inserted: number; skipped: number }>;
  message?: string;
}

interface ProgressLog {
  key: string;
  label: string;
  inserted: number;
  skipped: number;
  lastError?: string;
}

interface FilePreview {
  exportedAt: string;
  version: string;
  exportType: string;
  passwordsIncluded: boolean;
  tableCounts: Record<string, number>;
  totalRecords: number;
  fileSizeKb: number;
}

const TABLE_META: { key: keyof Counts; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "users",                   label: "Users",              icon: <Users className="h-4 w-4" />,        color: "bg-blue-50 text-blue-600" },
  { key: "subjects",                label: "Subjects",           icon: <BookOpen className="h-4 w-4" />,      color: "bg-amber-50 text-amber-600" },
  { key: "chapters",                label: "Chapters",           icon: <BookOpen className="h-4 w-4" />,      color: "bg-orange-50 text-orange-600" },
  { key: "tests",                   label: "Tests",              icon: <ClipboardList className="h-4 w-4" />, color: "bg-pink-50 text-pink-600" },
  { key: "testSections",            label: "Test Sections",      icon: <FileText className="h-4 w-4" />,      color: "bg-rose-50 text-rose-600" },
  { key: "testQuestions",           label: "Test Questions",     icon: <FileText className="h-4 w-4" />,      color: "bg-fuchsia-50 text-fuchsia-600" },
  { key: "testSubmissions",         label: "Submissions",        icon: <TrendingUp className="h-4 w-4" />,    color: "bg-indigo-50 text-indigo-600" },
  { key: "testQuestionReports",     label: "Q Reports",          icon: <AlertTriangle className="h-4 w-4" />, color: "bg-red-50 text-red-600" },
  { key: "questionBankQuestions",   label: "Question Bank",      icon: <Database className="h-4 w-4" />,      color: "bg-teal-50 text-teal-600" },
  { key: "questionBankProgress",    label: "QB Progress",        icon: <BarChart3 className="h-4 w-4" />,     color: "bg-cyan-50 text-cyan-600" },
  { key: "questionBankSaved",       label: "QB Saved",           icon: <BookOpen className="h-4 w-4" />,      color: "bg-blue-50 text-blue-700" },
  { key: "activityLogs",            label: "Activity Logs",      icon: <Activity className="h-4 w-4" />,      color: "bg-slate-50 text-slate-600" },
  { key: "sessions",                label: "Sessions",           icon: <Eye className="h-4 w-4" />,           color: "bg-gray-50 text-gray-600" },
  { key: "notifications",           label: "Notifications",      icon: <Bell className="h-4 w-4" />,          color: "bg-yellow-50 text-yellow-600" },
  { key: "directMessages",          label: "Direct Messages",    icon: <MessageSquare className="h-4 w-4" />, color: "bg-violet-50 text-violet-700" },
  { key: "emailSendLogs",           label: "Email Logs",         icon: <Mail className="h-4 w-4" />,          color: "bg-indigo-50 text-indigo-700" },
  { key: "emailProviderDailyUsage", label: "Email Usage",        icon: <TrendingUp className="h-4 w-4" />,    color: "bg-amber-50 text-amber-700" },
  { key: "passwordResetRequests",   label: "Password Resets",    icon: <Key className="h-4 w-4" />,           color: "bg-slate-50 text-slate-700" },
  { key: "paymentHistory",          label: "Payment History",    icon: <IndianRupee className="h-4 w-4" />,   color: "bg-emerald-50 text-emerald-700" },
];

const SELECTIVE_CATEGORIES = [
  {
    label: "Students & Users",
    slug: "students-users",
    icon: <Users className="h-5 w-5" />,
    color: "from-blue-500 to-indigo-500",
    shadow: "shadow-blue-100",
    tables: ["users", "sessions", "activityLogs", "passwordResetRequests", "notifications", "notificationPrefs", "directMessages"],
    description: "All user accounts, sessions, activity logs, and messages",
  },
  {
    label: "Tests & Results",
    slug: "tests-results",
    icon: <ClipboardList className="h-5 w-5" />,
    color: "from-pink-500 to-rose-500",
    shadow: "shadow-pink-100",
    tables: ["tests", "testSections", "testQuestions", "testSubmissions", "testQuestionReports", "testQuestionBankLinks"],
    description: "All tests, questions, student submissions and scores",
  },
  {
    label: "Question Bank",
    slug: "question-bank",
    icon: <Database className="h-5 w-5" />,
    color: "from-teal-500 to-emerald-500",
    shadow: "shadow-teal-100",
    tables: ["subjects", "chapters", "questionBankQuestions", "questionBankProgress", "questionBankSaved", "questionBankReports", "examTemplates"],
    description: "Subjects, chapters, question bank questions and progress",
  },
  {
    label: "Payments",
    slug: "payments",
    icon: <IndianRupee className="h-5 w-5" />,
    color: "from-emerald-500 to-green-500",
    shadow: "shadow-emerald-100",
    tables: ["paymentHistory"],
    description: "All student payment records — amount, cycle, order & payment IDs",
  },
];

const CSV_EXPORTS = [
  {
    label: "Students List",
    description: "All students — name, email, phone, subject, status",
    icon: <Users className="h-5 w-5" />,
    color: "from-blue-500 to-indigo-500",
    shadow: "shadow-blue-100",
    url: "/api/data-transfer/export/csv/students",
    filename: "students",
  },
  {
    label: "Test Results",
    description: "All test submissions — scores, percentages, student details",
    icon: <ClipboardList className="h-5 w-5" />,
    color: "from-pink-500 to-rose-500",
    shadow: "shadow-pink-100",
    url: "/api/data-transfer/export/csv/test-results",
    filename: "test-results",
  },
  {
    label: "Question Bank Structure",
    description: "All subjects & chapters — title, description, order, target questions",
    icon: <BookOpen className="h-5 w-5" />,
    color: "from-teal-500 to-emerald-500",
    shadow: "shadow-teal-100",
    url: "/api/data-transfer/export/csv/question-bank-structure",
    filename: "question-bank-structure",
  },
  {
    label: "Payment History",
    description: "All student payments — amount, date, cycle, order & payment IDs",
    icon: <IndianRupee className="h-5 w-5" />,
    color: "from-emerald-500 to-teal-500",
    shadow: "shadow-emerald-100",
    url: "/api/data-transfer/export/csv/payments",
    filename: "payment-history",
  },
];

export default function DataTransfer() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting]             = useState(false);
  const [exportingFull, setExportingFull]     = useState(false);
  const [exportBytesReceived, setExportBytesReceived]         = useState(0);
  const [exportFullBytesReceived, setExportFullBytesReceived] = useState(0);
  const [sendingEmail, setSendingEmail]   = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [pendingFile, setPendingFile]     = useState<File | null>(null);
  const [filePreview, setFilePreview]     = useState<FilePreview | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const [selectiveLoading, setSelectiveLoading] = useState<string | null>(null);
  const [csvLoading, setCsvLoading]             = useState<string | null>(null);
  const [viewTable, setViewTable]               = useState<string | null>(null);
  const [viewPage, setViewPage]                 = useState(0);   // 0-based page index
  const VIEW_LIMIT = 100;

  // ── Table viewer: edit / delete state ─────────────────────────────────────
  const [selectedIds, setSelectedIds]       = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow]         = useState<Record<string, any> | null>(null);
  const [editFields, setEditFields]         = useState<Record<string, string>>({});
  const [editSaving, setEditSaving]         = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<number[] | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const queryClient = useQueryClient();

  const [importing, setImporting]           = useState(false);
  const [importDone, setImportDone]         = useState(0);
  const [importTotal, setImportTotal]       = useState(40);
  const [importUploadPct, setImportUploadPct] = useState(0);
  const [currentLabel, setCurrentLabel]     = useState("");
  const [progressLog, setProgressLog]       = useState<ProgressLog[]>([]);
  const [importResult, setImportResult]     = useState<ImportResult | null>(null);
  const [importError, setImportError]       = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // ── User accounts import / export state ──────────────────────────────────
  const [userExporting, setUserExporting]     = useState(false);
  const [userImporting, setUserImporting]     = useState(false);
  const [userImportResult, setUserImportResult] = useState<{
    inserted: number; updated: number; skipped: number; total: number; errors?: string[];
  } | null>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);

  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery<{ counts: Counts }>({
    queryKey: ["data-transfer-stats"],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/data-transfer/export/stats`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load stats");
      return r.json();
    },
  });

  const { data: tableData, isLoading: tableLoading, isError: tableError, error: tableErrorMsg, refetch: refetchTable } = useQuery<{
    key: string; label: string; total: number; shown: number; rows: Record<string, any>[]; limit: number; offset: number;
  }>({
    queryKey: ["data-transfer-table", viewTable, viewPage, VIEW_LIMIT],
    queryFn: async () => {
      const offset = viewPage * VIEW_LIMIT;
      const r = await fetch(
        buildApiUrl(`/api/data-transfer/table/${viewTable}?limit=${VIEW_LIMIT}&offset=${offset}`),
        { credentials: "include" }
      );
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail?.detail ?? detail?.error ?? `Server error ${r.status}`);
      }
      return r.json();
    },
    enabled: !!viewTable,
    retry: 1,
  });

  // Reset selection / edit / page state when table changes
  useEffect(() => {
    setSelectedIds(new Set());
    setEditingRow(null);
    setConfirmDeleteIds(null);
    setViewPage(0);
  }, [viewTable]);

  function toggleRowId(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllRows(rows: Record<string, any>[]) {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(r => r.id as number)));
    }
  }

  function openEditRow(row: Record<string, any>) {
    setEditingRow(row);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "passwordHash") continue;
      fields[k] = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    setEditFields(fields);
  }

  async function handleEditSave() {
    if (!editingRow || !viewTable) return;
    setEditSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const [k, v] of Object.entries(editFields)) {
        if (k === "id") { payload[k] = editingRow.id; continue; }
        payload[k] = v === "" ? null : v;
      }
      const r = await fetch(buildApiUrl(`/api/data-transfer/table/${viewTable}/${editingRow.id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail ?? data?.error ?? "Update failed");
      toast({ title: "Row updated", description: `id=${editingRow.id} saved.` });
      setEditingRow(null);
      await refetchTable();
      refetchStats();
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteRows(ids: number[]) {
    if (!viewTable || ids.length === 0) return;
    setDeleting(true);
    try {
      const r = await fetch(buildApiUrl(`/api/data-transfer/table/${viewTable}`), {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail ?? data?.error ?? "Delete failed");
      toast({ title: `${data.deleted} row${data.deleted !== 1 ? "s" : ""} deleted` });
      setConfirmDeleteIds(null);
      setSelectedIds(new Set());
      await refetchTable();
      refetchStats();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const totalRows = statsData ? Object.values(statsData.counts).reduce((s, v) => s + v, 0) : 0;
  // Combined progress: upload phase = 0–40%, import phase = 40–100%
  const pct = importUploadPct < 100
    ? Math.round(importUploadPct * 0.4)
    : 40 + Math.round((importDone / Math.max(importTotal, 1)) * 60);
  const isUploading = importing && importUploadPct < 100;

  async function doExport(full: boolean) {
    if (full) { setExportingFull(true); setExportFullBytesReceived(0); }
    else      { setExporting(true);     setExportBytesReceived(0); }
    try {
      const url = full ? buildApiUrl(`/api/data-transfer/export/full`) : buildApiUrl(`/api/data-transfer/export`);
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.detail ?? e?.error ?? "Export failed"); }

      // Stream the response body so we can track bytes as they arrive
      const reader = r.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (full) setExportFullBytesReceived(received);
          else      setExportBytesReceived(received);
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="(.+?)"/);
      a.download = match?.[1] ?? `edtech-${full ? "FULL-MIGRATION" : "export"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      const sizeMb = (received / 1024 / 1024).toFixed(1);
    } catch (e: any) {
      console.error("Export failed", e);
    } finally { setExporting(false); setExportingFull(false); }
  }

  async function doSelectiveExport(category: typeof SELECTIVE_CATEGORIES[0]) {
    setSelectiveLoading(category.slug);
    try {
      const r = await fetch(buildApiUrl(`/api/data-transfer/export/selective`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: category.tables, label: category.label }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.detail ?? e?.error ?? "Export failed"); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="(.+?)"/);
      a.download = match?.[1] ?? `edtech-${category.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      console.error("Selective export failed", e);
    } finally { setSelectiveLoading(null); }
  }

  async function doCsvExport(csv: typeof CSV_EXPORTS[0]) {
    setCsvLoading(csv.filename);
    try {
      const r = await fetch(buildApiUrl(`${csv.url}`), { credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.detail ?? e?.error ?? "CSV export failed"); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="(.+?)"/);
      a.download = match?.[1] ?? `${csv.filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      console.error("CSV export failed", e);
    } finally { setCsvLoading(null); }
  }

  // ── User accounts export (with passwords) ────────────────────────────────
  const doUserExport = useCallback(async () => {
    setUserExporting(true);
    try {
      const r = await fetch(buildApiUrl(`/api/data-transfer/export/users`), { credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.detail ?? e?.error ?? "Export failed"); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="(.+?)"/);
      a.download = match?.[1] ?? `rankpulse-users-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      console.error("User export failed", e);
    } finally { setUserExporting(false); }
  }, [toast]);

  // ── User accounts import (merge / upsert) ────────────────────────────────
  function extractImportedUsers(value: unknown): unknown[] | null {
    const userKeys = new Set([
      "users", "useraccounts", "user_accounts", "accounts", "account",
      "members", "students", "profiles", "userlist", "user_list",
      "records", "rows", "items",
    ]);
    const visited = new Set<object>();

    const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
      !!candidate && typeof candidate === "object" && !Array.isArray(candidate);
    const looksLikeUser = (candidate: unknown): candidate is Record<string, unknown> => {
      if (!isObject(candidate)) return false;
      return [
        "email", "emailaddress", "mail", "username", "username",
        "user_name", "login", "user", "userid", "user_id",
      ].some((key) =>
        Object.keys(candidate).some((actual) => actual.toLowerCase() === key),
      );
    };
    const normalizeKey = (key: string) => key.toLowerCase().replace(/[-\s]/g, "_");

    const visit = (candidate: unknown, depth: number): unknown[] | null => {
      if (depth > 6 || candidate === null || candidate === undefined) return null;
      if (Array.isArray(candidate)) {
        return candidate.length > 0 && candidate.some(looksLikeUser) ? candidate : null;
      }
      if (!isObject(candidate) || visited.has(candidate)) return null;
      visited.add(candidate);

      const entries = Object.entries(candidate);
      for (const [key, nested] of entries) {
        const normalizedKey = normalizeKey(key);
        if (userKeys.has(normalizedKey)) {
          if (Array.isArray(nested) && nested.length > 0) return nested;
          if (isObject(nested)) {
            const values = Object.values(nested);
            if (values.length > 0 && values.some(looksLikeUser)) return values;
          }
        }
      }

      if (looksLikeUser(candidate)) return [candidate];

      // Walk nested envelopes and unknown export wrappers too. We only accept
      // arrays that contain account-like records, so unrelated tables are not
      // accidentally sent to the user endpoint.
      for (const [key, nested] of entries) {
        const found = visit(nested, depth + 1);
        if (found) return found;
      }
      return null;
    };

    return visit(value, 0);
  }

  const handleUserFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (userFileInputRef.current) userFileInputRef.current.value = "";
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      toast({ title: "Invalid file", description: "Please select a .json user export file.", variant: "destructive" });
      return;
    }
    setUserImporting(true);
    setUserImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept the app's exports plus root arrays and common migration
      // envelopes (data/users, payload/users, tables/users, etc.).
      const users = extractImportedUsers(parsed);
      if (!users || users.length === 0) {
        throw new Error("No user account records found. Select a User Accounts export or a JSON file containing email/username fields.");
      }
      const r = await fetch(buildApiUrl(`/api/data-transfer/import/users`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Import failed");
      setUserImportResult(data.summary);
      toast({
        title: "User import complete",
        description: `${data.summary.inserted} added, ${data.summary.updated} updated, ${data.summary.skipped} skipped.`,
      });
      refetchStats();
    } catch (e: any) {
      console.error("User import failed", e);
      toast({ title: "User import failed", description: e?.message ?? "Could not import the user file.", variant: "destructive" });
    } finally { setUserImporting(false); }
  }, [toast, refetchStats]);

  async function handleSendBackupEmail() {
    setSendingEmail(true);
    try {
      const r = await fetch(buildApiUrl(`/api/data-transfer/send-backup-email`), { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Failed to send");
    } catch (e: any) {
      console.error("Email failed", e);
    } finally { setSendingEmail(false); }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".json")) {
      return;
    }

    const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB

    try {
      if (file.size > LARGE_FILE_THRESHOLD) {
        // For large files (e.g. 450 MB), avoid reading the whole file into memory
        // just for a preview. Read the first 64 KB to extract top-level metadata.
        const headBlob = file.slice(0, 64 * 1024);
        const headText = await headBlob.text();

        // Extract version using a simple regex so we never call JSON.parse on the full file
        const versionMatch = headText.match(/"version"\s*:\s*"?([^",}\s]+)"?/);
        const exportedAtMatch = headText.match(/"exportedAt"\s*:\s*"([^"]+)"/);
        const exportTypeMatch = headText.match(/"exportType"\s*:\s*"([^"]+)"/);
        const passwordsMatch = headText.match(/"passwordsIncluded"\s*:\s*(true|false)/);

        const version = versionMatch?.[1] ?? "?";
        // Quick validity check — must look like a known export file
        if (!headText.includes('"tables"') || !version || version === "?") {
          toast({ title: "Invalid file", description: "This does not look like a valid export file.", variant: "destructive" });
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        setFilePreview({
          exportedAt: exportedAtMatch?.[1] ?? "",
          version,
          exportType: exportTypeMatch?.[1] ?? "standard",
          passwordsIncluded: passwordsMatch?.[1] === "true",
          // Cannot count records without parsing — show the file size as a hint
          tableCounts: {},
          totalRecords: -1, // signals "large file — counts not available"
          fileSizeKb: Math.round(file.size / 1024),
        });
      } else {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed?.tables || !parsed?.version) {
          return;
        }
        const counts: Record<string, number> = {};
        let total = 0;
        for (const [key, val] of Object.entries(parsed.tables ?? {})) {
          const n = Array.isArray(val) ? val.length : 0;
          counts[key] = n;
          total += n;
        }
        setFilePreview({
          exportedAt: parsed.exportedAt ?? "",
          version: parsed.version ?? "?",
          exportType: parsed.meta?.exportType ?? parsed.exportType ?? "standard",
          passwordsIncluded: parsed.meta?.passwordsIncluded ?? false,
          tableCounts: counts,
          totalRecords: total,
          fileSizeKb: Math.round(file.size / 1024),
        });
      }

      setPendingFile(file);
      setConfirmImport(true);
      setImportResult(null);
      setImportError(null);
      setProgressLog([]);
      setImportDone(0);
      setPreviewExpanded(false);
    } catch {
      // invalid JSON or read error — silently ignore
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function executeImport() {
    if (!pendingFile) return;
    setImporting(true);
    setConfirmImport(false);
    setImportResult(null);
    setImportError(null);
    setProgressLog([]);
    setImportDone(0);
    setImportUploadPct(0);
    setCurrentLabel("Reading file…");

    try {
      const text = await pendingFile.text();

      // ── Chunked upload: split into 20 MB pieces ──────────────────────
      const CHUNK_BYTES = 20 * 1024 * 1024;
      const totalChunks = Math.ceil(text.length / CHUNK_BYTES);
      const sessionId   = Date.now().toString(36) + Math.random().toString(36).slice(2);

      for (let i = 0; i < totalChunks; i++) {
        const slice = text.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
        const loadedMB = ((i + 1) * CHUNK_BYTES / 1024 / 1024).toFixed(0);
        const totalMB  = (text.length / 1024 / 1024).toFixed(0);
        setCurrentLabel(`Uploading chunk ${i + 1} / ${totalChunks}… ${loadedMB} / ${totalMB} MB`);
        setImportUploadPct(Math.round(((i + 1) / totalChunks) * 100));

        const resp = await fetch(buildApiUrl(`/api/data-transfer/import/chunk`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, chunkIndex: i, totalChunks, data: slice }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err?.error ?? `Chunk ${i + 1} upload failed (${resp.status})`);
        }
      }

      setImportUploadPct(100);
      setCurrentLabel("Processing on server…");

      // ── Finalize: stream NDJSON progress ─────────────────────────────
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", buildApiUrl(`/api/data-transfer/import/finalize`));
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.withCredentials = true;
        xhr.timeout = 3_600_000;

        let lastLen = 0;
        let buffer  = "";
        let hasError = false;

        const processBuffer = () => {
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const evt: ProgressEvent = JSON.parse(trimmed);
              if (evt.type === "start") {
                setCurrentLabel(evt.label ?? "");
                setImportTotal(evt.totalSteps ?? 40);
              } else if (evt.type === "done") {
                setImportDone(evt.done ?? 0);
                setCurrentLabel(evt.label ?? "");
                if (evt.key && evt.label !== undefined) {
                  setProgressLog(prev => [...prev, {
                    key: evt.key!, label: evt.label!,
                    inserted: evt.inserted ?? 0, skipped: evt.skipped ?? 0,
                    lastError: evt.lastError,
                  }]);
                  setTimeout(() => {
                    progressRef.current?.scrollTo({ top: progressRef.current.scrollHeight, behavior: "smooth" });
                  }, 50);
                }
              } else if (evt.type === "complete") {
                setImportDone(evt.totalSteps ?? 40);
                setCurrentLabel("Done!");
                setImportResult({ success: true, summary: evt.summary!, details: evt.details ?? {} });
                refetchStats();
              } else if (evt.type === "error") {
                hasError = true;
                reject(new Error(evt.message ?? "Import failed"));
                return;
              }
            } catch {
              // Partial / malformed line — wait for more data
            }
          }
        };

        xhr.onprogress = () => {
          if (hasError) return;
          const newText = xhr.responseText.slice(lastLen);
          lastLen = xhr.responseText.length;
          buffer += newText;
          processBuffer();
        };

        xhr.onload = () => {
          if (hasError) return;
          if (xhr.responseText.length > lastLen) {
            buffer += xhr.responseText.slice(lastLen);
          }
          processBuffer();
          if (xhr.status >= 400) {
            let errMsg = "Import failed";
            try { errMsg = JSON.parse(xhr.responseText)?.error ?? errMsg; } catch {}
            reject(new Error(`Server error ${xhr.status}: ${errMsg}`));
          } else {
            resolve();
          }
        };

        xhr.onerror   = () => reject(new Error("Network error during import"));
        xhr.ontimeout = () => reject(new Error("Import timed out after 60 minutes"));

        xhr.send(JSON.stringify({ sessionId }));
      });

    } catch (e: any) {
      setImportError(e?.message ?? "Import failed");
    } finally {
      setImporting(false);
      setPendingFile(null);
      setFilePreview(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-200">
            <HardDrive className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Data Transfer</h1>
            <p className="text-sm text-slate-500">Export, import, backup — every format, every table</p>
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm text-amber-800">
            <span className="font-bold">Super Admin only.</span> The <span className="font-semibold">Full Migration Export</span> includes hashed passwords and <strong>all 39 database tables</strong> — use it when moving to a new hosting/database. Store it securely.
          </div>
        </div>

        {/* Live stats */}
        <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-500" /> Live Database — All Tables
              </CardTitle>
              <div className="flex items-center gap-3">
                {!statsLoading && (
                  <Badge variant="outline" className="text-xs font-semibold border-indigo-200 text-indigo-600 bg-indigo-50">
                    {totalRows.toLocaleString()} total rows
                  </Badge>
                )}
                <button onClick={() => refetchStats()} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <RefreshCw className={`h-4 w-4 ${statsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {TABLE_META.map(({ key, label, icon, color }) => (
                  <button
                    key={key}
                    onClick={() => setViewTable(key)}
                    className="flex items-center gap-2.5 rounded-2xl bg-white border border-slate-100 px-3 py-2.5 shadow-sm hover:border-indigo-200 hover:shadow-md hover:bg-indigo-50/30 transition-all text-left group"
                  >
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${color}`}>{icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-slate-900 tabular-nums">{(statsData?.counts[key] ?? 0).toLocaleString()}</p>
                      <p className="truncate text-[10px] font-medium text-slate-500 leading-tight">{label}</p>
                    </div>
                    <Eye className="h-3 w-3 text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 1: Full Backups ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">Full Platform Backup</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">

            {/* Full migration export */}
            <Card className="rounded-3xl border-2 border-indigo-200 shadow-[0_4px_20px_rgba(79,70,229,0.12)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-100">
                    <Lock className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-900">Full Migration Export</h2>
                    <Badge className="mt-0.5 bg-indigo-100 text-indigo-700 border-0 text-[10px] font-bold">PASSWORDS INCLUDED</Badge>
                  </div>
                </div>
                <p className="text-sm text-slate-500">Complete backup for moving to a fresh database. All 39 tables, hashed passwords — <span className="font-semibold text-slate-700">zero data loss</span>.</p>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" /> All 39 tables including passwords</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" /> Test submissions, marks & activity logs</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" /> Email logs, support tickets, feedback</div>
                </div>
                <Button onClick={() => doExport(true)} disabled={exportingFull}
                  className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold shadow-md hover:opacity-90">
                  {exportingFull ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      <span className="truncate">
                        {exportFullBytesReceived > 0
                          ? `${(exportFullBytesReceived / 1024 / 1024).toFixed(1)} MB received…`
                          : "Building export…"}
                      </span>
                    </span>
                  ) : <><Lock className="mr-2 h-4 w-4" />Download Full Export</>}
                </Button>
                {exportingFull && exportFullBytesReceived > 0 && (
                  <div className="w-full rounded-full bg-indigo-100 h-1.5 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                      style={{ width: `${Math.min(100, (exportFullBytesReceived / 1024 / 1024) * 4)}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Standard export */}
            <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-100">
                  <Download className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">Standard Export</h2>
                  <p className="mt-1 text-sm text-slate-500">All data <span className="font-semibold text-slate-700">except passwords</span> — safe for analytics backups.</p>
                </div>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> All 39 tables, no passwords</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Safe to store / share</div>
                </div>
                <Button onClick={() => doExport(false)} disabled={exporting}
                  className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold shadow-md hover:opacity-90">
                  {exporting ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      <span className="truncate">
                        {exportBytesReceived > 0
                          ? `${(exportBytesReceived / 1024 / 1024).toFixed(1)} MB received…`
                          : "Building export…"}
                      </span>
                    </span>
                  ) : <><Download className="mr-2 h-4 w-4" />Download Export</>}
                </Button>
                {exporting && exportBytesReceived > 0 && (
                  <div className="w-full rounded-full bg-emerald-100 h-1.5 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                      style={{ width: `${Math.min(100, (exportBytesReceived / 1024 / 1024) * 4)}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Import */}
            <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-100">
                  <Upload className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">Import / Restore</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Restore a previous export. Existing records are <span className="font-semibold text-slate-700">skipped</span>. File is previewed before import begins.
                  </p>
                </div>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> All 39 tables — dependency order preserved</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> File preview before confirming</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Live progress bar — real-time table updates</div>
                </div>
                <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
                <Button onClick={() => fileInputRef.current?.click()} disabled={importing || confirmImport}
                  className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-md hover:opacity-90">
                  {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</> : <><FileJson className="mr-2 h-4 w-4" />Select Export File</>}
                </Button>
              </CardContent>
            </Card>

            {/* Student data email */}
            <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-100">
                  <Send className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">Student Data Email</h2>
                  <p className="mt-1 text-sm text-slate-500">Email a backup of all student accounts to your admin email. You can also trigger one now.</p>
                </div>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500" /> Only student accounts included</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500" /> Sent to your admin email via Gmail</div>
                </div>
                <Button onClick={handleSendBackupEmail} disabled={sendingEmail}
                  className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold shadow-md hover:opacity-90">
                  {sendingEmail ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Sending…</> : <><Send className="mr-2 h-4 w-4" />Send Student Data Email</>}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Section 2: Selective Exports ───────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">Selective Export</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <p className="text-sm text-slate-500 mb-4">Export only the data you need — no passwords ever included in selective exports.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SELECTIVE_CATEGORIES.map((cat) => {
              const isLoading = selectiveLoading === cat.slug;
              return (
                <Card key={cat.slug} className="rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${cat.color} shadow-md ${cat.shadow} text-white`}>
                        {cat.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm leading-tight">{cat.label}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{cat.tables.length} tables</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{cat.description}</p>
                    <Button
                      size="sm"
                      onClick={() => doSelectiveExport(cat)}
                      disabled={isLoading || selectiveLoading !== null}
                      className={`w-full rounded-xl bg-gradient-to-r ${cat.color} text-white font-bold text-xs hover:opacity-90 shadow-sm`}
                    >
                      {isLoading
                        ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Exporting…</>
                        : <><Download className="mr-1.5 h-3.5 w-3.5" />Export JSON</>}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* ── Section 3: CSV Exports ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">CSV Reports</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <p className="text-sm text-slate-500 mb-4">Download data as CSV — ready for Excel, Google Sheets, or any analytics tool.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {CSV_EXPORTS.map((csv) => {
              const isLoading = csvLoading === csv.filename;
              return (
                <Card key={csv.filename} className="rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${csv.color} shadow-md ${csv.shadow} text-white`}>
                      {csv.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm">{csv.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{csv.description}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => doCsvExport(csv)}
                      disabled={isLoading || csvLoading !== null}
                      className={`shrink-0 rounded-xl bg-gradient-to-r ${csv.color} text-white font-bold text-xs hover:opacity-90 shadow-sm px-3`}
                    >
                      {isLoading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />CSV</>}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* ── Section 4: User Accounts Import / Export ──────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">User Accounts</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 mb-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <p className="text-sm text-blue-800">
              <span className="font-bold">Passwords included.</span> This export contains hashed passwords and all user details.
              Import <span className="font-semibold">merges</span> users — existing records are updated, new ones are added. Super-admin accounts are never demoted.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">

            {/* Export user accounts */}
            <Card className="rounded-3xl border-2 border-blue-200 shadow-[0_4px_20px_rgba(59,130,246,0.12)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-100">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-900">Export User Accounts</h2>
                    <Badge className="mt-0.5 bg-blue-100 text-blue-700 border-0 text-[10px] font-bold">PASSWORDS INCLUDED</Badge>
                  </div>
                </div>
                <p className="text-sm text-slate-500">
                  Download all user accounts — students, admins, teachers — with full details and hashed passwords.
                  Use to migrate logins to a new server or create a backup.
                </p>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> All roles: students, admins, super_admin</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-blue-500" /> All fields: name, email, phone, subject, status</div>
                  <div className="flex items-center gap-1.5"><Key className="h-3.5 w-3.5 text-blue-500" /> Hashed passwords included for login restore</div>
                </div>
                <Button
                  onClick={doUserExport}
                  disabled={userExporting}
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-md hover:opacity-90"
                >
                  {userExporting
                    ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Exporting…</>
                    : <><Download className="mr-2 h-4 w-4" />Export User Accounts</>}
                </Button>
              </CardContent>
            </Card>

            {/* Import user accounts */}
            <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 shadow-lg shadow-violet-100">
                    <Upload className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-900">Import User Accounts</h2>
                    <Badge className="mt-0.5 bg-violet-100 text-violet-700 border-0 text-[10px] font-bold">MERGE MODE</Badge>
                  </div>
                </div>
                <p className="text-sm text-slate-500">
                  Upload a user export file to add or update accounts. Existing users are updated with new data.
                  Works with both the User Accounts export and the Full Migration export.
                </p>
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500" /> Merges into existing DB — no data loss</div>
                  <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-violet-500" /> Passwords restored with original hashes</div>
                  <div className="flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-violet-500" /> Super-admin accounts protected</div>
                </div>

                {userImportResult && (
                  <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs space-y-1">
                    <p className="font-bold text-violet-800">Last import result:</p>
                    <div className="flex gap-3 flex-wrap">
                      <span className="text-emerald-700 font-semibold">+{userImportResult.inserted} added</span>
                      <span className="text-blue-700 font-semibold">↺ {userImportResult.updated} updated</span>
                      <span className="text-slate-500 font-semibold">{userImportResult.skipped} skipped</span>
                      <span className="text-slate-400">of {userImportResult.total} total</span>
                    </div>
                    {userImportResult.errors && userImportResult.errors.length > 0 && (
                      <p className="text-red-600 font-medium">{userImportResult.errors.length} error(s) — check console</p>
                    )}
                  </div>
                )}

                <input ref={userFileInputRef} type="file" accept=".json" className="hidden" onChange={handleUserFileSelect} />
                <Button
                  onClick={() => userFileInputRef.current?.click()}
                  disabled={userImporting}
                  className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold shadow-md hover:opacity-90"
                >
                  {userImporting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing users…</>
                    : <><FileJson className="mr-2 h-4 w-4" />Select User Export File</>}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Import File Preview ───────────────────────────────────────── */}
        {confirmImport && pendingFile && filePreview && (
          <Card className="rounded-3xl border-2 border-amber-300 bg-amber-50 shadow-[0_8px_30px_rgba(245,158,11,0.15)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100">
                  <Info className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-base font-black text-slate-900">Import Preview</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-slate-100 text-slate-600 border-0 text-[10px] font-bold">v{filePreview.version}</Badge>
                      <Badge className={`border-0 text-[10px] font-bold ${filePreview.passwordsIncluded ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {filePreview.passwordsIncluded ? "PASSWORDS INCLUDED" : "NO PASSWORDS"}
                      </Badge>
                      <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[10px] font-bold capitalize">{filePreview.exportType}</Badge>
                    </div>
                  </div>

                  {/* File meta row */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: "File", value: pendingFile.name },
                      { label: "Size", value: `${filePreview.fileSizeKb.toLocaleString()} KB` },
                      { label: "Records", value: filePreview.totalRecords.toLocaleString() },
                      { label: "Exported", value: filePreview.exportedAt ? new Date(filePreview.exportedAt).toLocaleDateString() : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl bg-white border border-amber-100 px-3 py-2">
                        <p className="text-[10px] text-slate-400 font-medium">{label}</p>
                        <p className="text-xs font-bold text-slate-800 truncate mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table breakdown toggle */}
                  <button
                    onClick={() => setPreviewExpanded(v => !v)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-amber-700 font-semibold hover:text-amber-900 transition-colors"
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    {previewExpanded ? "Hide" : "Show"} table breakdown ({Object.keys(filePreview.tableCounts).length} tables)
                    {previewExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {previewExpanded && (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-white overflow-hidden max-h-56 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-50 sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2 font-bold text-slate-600">Table</th>
                            <th className="text-right px-3 py-2 font-bold text-slate-600">In File</th>
                            <th className="text-right px-3 py-2 font-bold text-slate-600">In DB Now</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(filePreview.tableCounts)
                            .filter(([, v]) => v > 0)
                            .sort(([, a], [, b]) => b - a)
                            .map(([key, count]) => {
                              const dbCount = statsData?.counts[key as keyof Counts] ?? 0;
                              return (
                                <tr key={key} className="hover:bg-amber-50/50">
                                  <td className="px-3 py-1.5 font-medium text-slate-700">{key}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-indigo-700 font-bold">{count.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{dbCount.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="mt-3 text-sm text-slate-700">
                    New records will be added — existing IDs will be <span className="font-semibold">skipped</span>. Live progress shown table-by-table.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <Button onClick={executeImport} className="rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600">
                      <Upload className="mr-2 h-4 w-4" /> Yes, Import
                    </Button>
                    <Button variant="outline" onClick={() => { setConfirmImport(false); setPendingFile(null); setFilePreview(null); }} className="rounded-xl">
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Live import progress ─────────────────────────────────────────── */}
        {(importing || (importResult && progressLog.length > 0)) && (
          <Card className="rounded-3xl border border-slate-200 shadow-[0_8px_30px_rgba(15,23,42,0.08)] overflow-hidden">
            <CardContent className="p-0">
              <div className={`px-6 pt-5 pb-4 ${importing ? "bg-gradient-to-r from-indigo-50 to-violet-50" : "bg-gradient-to-r from-emerald-50 to-teal-50"}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {importing
                      ? <Loader2 className="h-5 w-5 text-indigo-500 animate-spin" />
                      : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                    <div>
                      <span className="font-bold text-slate-800 text-sm block">
                        {importing
                          ? isUploading ? "Uploading file…" : `Importing… ${currentLabel}`
                          : "Import Complete"}
                      </span>
                      {importing && isUploading && (
                        <span className="text-xs text-indigo-500 font-medium">{currentLabel}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-black tabular-nums text-slate-700">{pct}%</span>
                </div>
                <div className="w-full h-3 bg-white/70 rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${importing ? "bg-gradient-to-r from-indigo-500 to-violet-500" : "bg-gradient-to-r from-emerald-500 to-teal-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-slate-500">
                  {isUploading
                    ? <span className="text-indigo-600 font-semibold">Phase 1/2 — Uploading ({importUploadPct}%)</span>
                    : <span>{importDone} / {importTotal} tables</span>}
                  {importResult && (
                    <span className="font-semibold text-emerald-700">
                      {importResult.summary.totalInserted.toLocaleString()} inserted · {importResult.summary.totalSkipped.toLocaleString()} skipped
                    </span>
                  )}
                </div>
              </div>
              <div ref={progressRef} className="max-h-64 overflow-y-auto divide-y divide-slate-100 bg-white">
                {progressLog.map((entry, i) => (
                  <div key={i} className={`px-6 py-2.5 text-sm ${entry.skipped > 0 && entry.inserted === 0 ? "bg-red-50/50" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className={`h-4 w-4 shrink-0 ${entry.skipped > 0 && entry.inserted === 0 ? "text-red-400" : "text-emerald-500"}`} />
                        <span className="text-slate-700 font-medium">{entry.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs tabular-nums">
                        {entry.inserted > 0 && <span className="text-emerald-600 font-semibold">+{entry.inserted.toLocaleString()}</span>}
                        {entry.skipped > 0 && <span className="text-red-500 font-semibold">{entry.skipped} failed</span>}
                      </div>
                    </div>
                    {entry.lastError && (
                      <p className="mt-1 ml-6 text-xs text-red-500 break-words">{entry.lastError}</p>
                    )}
                  </div>
                ))}
                {importing && !isUploading && currentLabel && (
                  <div className="flex items-center gap-2 px-6 py-2.5 text-sm text-indigo-600 bg-indigo-50/50">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span className="font-medium">{currentLabel}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Import error ──────────────────────────────────────────────────── */}
        {importError && (
          <Card className="rounded-3xl border-2 border-red-200 bg-red-50">
            <CardContent className="p-5 flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-red-800 text-sm">Import failed</p>
                <p className="text-sm text-red-700 mt-0.5 font-mono break-all">{importError}</p>
              </div>
            </CardContent>
          </Card>
        )}

      </div>

      {/* ── Table Data Viewer Dialog ─────────────────────────────────────── */}
      <Dialog open={!!viewTable} onOpenChange={(open) => { if (!open) { setViewTable(null); setSelectedIds(new Set()); setEditingRow(null); } }}>
        <DialogContent className="max-w-6xl w-full rounded-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Table2 className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-black text-slate-900">
                  {tableData?.label ?? TABLE_META.find(t => t.key === viewTable)?.label ?? viewTable}
                </DialogTitle>
                {tableData && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tableData.total.toLocaleString()} rows total
                    {tableData.shown < tableData.total && ` — showing first ${tableData.shown.toLocaleString()}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs font-bold rounded-xl gap-1"
                    onClick={() => setConfirmDeleteIds([...selectedIds])}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete {selectedIds.size}
                  </Button>
                )}
                {tableData && tableData.rows.length > 0 && (
                  <Badge variant="outline" className="text-xs font-semibold border-indigo-200 text-indigo-600 bg-indigo-50">
                    {tableData.rows.length} rows
                  </Badge>
                )}
                <button
                  onClick={() => { refetchTable(); setSelectedIds(new Set()); }}
                  className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
                  title="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${tableLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {tableLoading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm font-medium">Loading…</span>
              </div>
            ) : tableError ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-red-400">
                <XCircle className="h-8 w-8" />
                <p className="text-sm font-semibold">Failed to load table</p>
                <p className="text-xs text-slate-500 max-w-sm text-center">{(tableErrorMsg as Error)?.message ?? "Unknown error"}</p>
                <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => refetchTable()}>
                  Retry
                </Button>
              </div>
            ) : !tableData || tableData.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <Database className="h-8 w-8" />
                <p className="text-sm font-medium">{viewPage > 0 ? "No rows on this page" : "No rows in this table"}</p>
                {viewPage > 0 && (
                  <Button size="sm" variant="outline" className="mt-1 text-xs" onClick={() => setViewPage(0)}>
                    Back to page 1
                  </Button>
                )}
              </div>
            ) : (() => {
              const columns = Object.keys(tableData.rows[0]).filter(c => c !== "passwordHash");
              const allSelected = selectedIds.size === tableData.rows.length;
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10">
                      <tr>
                        <th className="px-3 py-2.5 border-b border-slate-200 w-8">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={() => toggleAllRows(tableData.rows)}
                            className="h-3.5 w-3.5"
                          />
                        </th>
                        {columns.map(col => (
                          <th key={col} className="text-left px-3 py-2.5 font-bold text-slate-600 border-b border-slate-200 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 border-b border-slate-200 text-slate-400 font-bold w-20 text-center">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tableData.rows.map((row, i) => {
                        const rowId = row.id as number;
                        const isSelected = selectedIds.has(rowId);
                        return (
                          <tr key={i} className={`transition-colors ${isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                            <td className="px-3 py-2 border-b border-slate-50 w-8">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRowId(rowId)}
                                className="h-3.5 w-3.5"
                              />
                            </td>
                            {columns.map(col => {
                              const val = row[col];
                              const display = val === null || val === undefined
                                ? <span className="text-slate-300 italic">null</span>
                                : typeof val === "object"
                                  ? <span className="font-mono text-slate-500">{JSON.stringify(val).slice(0, 100)}</span>
                                  : typeof val === "boolean"
                                    ? <span className={val ? "text-emerald-600 font-semibold" : "text-red-400"}>{String(val)}</span>
                                    : <span className="text-slate-700">{String(val).slice(0, 100)}</span>;
                              return (
                                <td key={col} className="px-3 py-2 border-b border-slate-50 whitespace-nowrap max-w-[180px] truncate">
                                  {display}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 border-b border-slate-50 w-20">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => openEditRow(row)}
                                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                  title="Edit row"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteIds([rowId])}
                                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  title="Delete row"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* ── Pagination bar ─────────────────────────────────────────────── */}
            {tableData && tableData.total > VIEW_LIMIT && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2.5 shrink-0">
                <span className="text-xs text-slate-500">
                  Showing {tableData.offset + 1}–{Math.min(tableData.offset + tableData.shown, tableData.total)} of {tableData.total.toLocaleString()} rows
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs font-semibold"
                    disabled={viewPage === 0 || tableLoading}
                    onClick={() => { setViewPage(p => Math.max(0, p - 1)); setSelectedIds(new Set()); }}
                  >
                    ← Prev
                  </Button>
                  <span className="text-xs font-semibold text-slate-600">
                    Page {viewPage + 1} / {Math.ceil(tableData.total / VIEW_LIMIT)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs font-semibold"
                    disabled={tableData.offset + tableData.shown >= tableData.total || tableLoading}
                    onClick={() => { setViewPage(p => p + 1); setSelectedIds(new Set()); }}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Row Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!editingRow} onOpenChange={(open) => { if (!open) setEditingRow(null); }}>
        <DialogContent className="max-w-2xl w-full rounded-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Pencil className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-base font-black text-slate-900">Edit Row</DialogTitle>
                {editingRow && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tableData?.label} · id={editingRow.id}
                  </p>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
            {editingRow && Object.entries(editFields).map(([key, val]) => {
              const isId = key === "id";
              const isLong = val.length > 80 || val.startsWith("{") || val.startsWith("[");
              return (
                <div key={key} className="grid grid-cols-[160px_1fr] items-start gap-3">
                  <Label className="text-xs font-bold text-slate-600 pt-2 text-right break-all leading-tight">
                    {key}
                    {isId && <span className="ml-1 text-slate-400 font-normal">(read-only)</span>}
                  </Label>
                  {isId ? (
                    <div className="text-xs text-slate-500 font-mono pt-2">{val}</div>
                  ) : isLong ? (
                    <Textarea
                      value={val}
                      onChange={e => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                      rows={3}
                      className="text-xs font-mono rounded-xl border-slate-200 resize-y"
                    />
                  ) : (
                    <Input
                      value={val}
                      onChange={e => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                      className="text-xs rounded-xl border-slate-200 h-8"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setEditingRow(null)}
              disabled={editSaving}
            >
              <XIcon className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
              onClick={handleEditSave}
              disabled={editSaving}
            >
              {editSaving
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
                : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Changes</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Delete Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!confirmDeleteIds} onOpenChange={(open) => { if (!open) setConfirmDeleteIds(null); }}>
        <DialogContent className="max-w-sm w-full rounded-3xl p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
              <Trash2 className="h-7 w-7" />
            </div>
            <div>
              <DialogTitle className="text-base font-black text-slate-900 mb-1">
                Delete {confirmDeleteIds?.length === 1 ? "this row" : `${confirmDeleteIds?.length} rows`}?
              </DialogTitle>
              <p className="text-sm text-slate-500">
                This will permanently delete{" "}
                <span className="font-semibold text-slate-700">
                  {confirmDeleteIds?.length === 1
                    ? `row id=${confirmDeleteIds[0]}`
                    : `${confirmDeleteIds?.length} rows`}
                </span>{" "}
                from <span className="font-semibold text-slate-700">{tableData?.label}</span>.
                This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setConfirmDeleteIds(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1 rounded-xl font-bold"
                onClick={() => confirmDeleteIds && handleDeleteRows(confirmDeleteIds)}
                disabled={deleting}
              >
                {deleting
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Deleting…</>
                  : <><Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
