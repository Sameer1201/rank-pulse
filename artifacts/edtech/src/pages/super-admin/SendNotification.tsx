import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Users, GraduationCap, UserCheck, Globe, Send,
  CheckCircle, AlertTriangle, Sparkles, Link as LinkIcon,
  Tag, ChevronDown, Mail, Eye, X, Search, RefreshCw,
  KeyRound, Clock3, Server, AtSign, Zap,
  Target, Rocket, BarChart2, Trophy, Moon, CalendarClock,
  Flame, Lightbulb, Medal, Ban, UserX, Timer, SlidersHorizontal,
  ShieldCheck, Wifi, WifiOff, TrendingUp, Filter, Activity,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { buildApiUrl } from "@/lib/api-origin";

type Target = "all" | "admins" | "students" | "inactive";
type NotifType = "system" | "grade" | "test";

type EmailLogEntry = {
  id: number;
  providerKey: string;
  providerName: string;
  providerSource: string;
  providerMaskedApiKey: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  messageType: string;
  status: "sent" | "failed" | string;
  errorMessage: string | null;
  metadata: string | null;
  sentAt: string | null;
};

interface HistoryEntry {
  target: string;
  title: string;
  message?: string;
  type: string;
  sent: number;
  time: Date;
}

const TARGETS: { value: Target; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "all",
    label: "Everyone",
    desc: "All teachers & students",
    icon: <Globe size={18} />,
    color: "from-violet-500 to-purple-600",
  },
  {
    value: "admins",
    label: "Admins / Teachers",
    desc: "Admin accounts only",
    icon: <UserCheck size={18} />,
    color: "from-orange-500 to-amber-600",
  },
  {
    value: "students",
    label: "Students",
    desc: "All student accounts",
    icon: <GraduationCap size={18} />,
    color: "from-emerald-500 to-teal-600",
  },
  {
    value: "inactive",
    label: "Inactive Students",
    desc: "Students inactive N+ days",
    icon: <Timer size={18} />,
    color: "from-red-500 to-rose-600",
  },
];

const TYPES: { value: NotifType; label: string; color: string }[] = [
  { value: "system", label: "System", color: "bg-amber-50 text-amber-700 border border-amber-200" },
  { value: "grade", label: "Grade", color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  { value: "test", label: "Test", color: "bg-orange-50 text-orange-700 border border-orange-200" },
];

function formatDateTime(value: string | null) {
  if (!value) return "No sends yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No sends yet";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function prettifyMessageType(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getEmailTypeLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    "password-reset": "Forgot Password",
    "password-changed": "Password Changed",
    "student-approved": "Student Verification Success",
    "student-rejected": "Student Verification Rejected",
    "teacher-welcome": "Teacher Welcome",
    "student-test-result": "Test Result",
    "student-question-report-acknowledged": "Question Report Ack",
    "teacher-question-report-alert": "Teacher Report Alert",
    "student-question-report-rejected": "Report Rejected",
    "student-question-updated": "Question Updated",
    "pending-review-escalation": "Pending Review Escalation",
    "student-review-request": "Student Review Request",
    transactional: "Transactional",
  };
  return labels[normalized] ?? prettifyMessageType(normalized);
}

const EMAIL_TYPE_COLORS = [
  "#F59E0B",
  "#D97706",
  "#F97316",
  "#FB7185",
  "#8B5CF6",
  "#6366F1",
  "#14B8A6",
  "#22C55E",
];

type EmailTemplate = {
  id: string;
  emoji: string;
  label: string;
  category: string;
  icon: React.ReactNode;
  accent: string;
  notifType: NotifType;
  title: string;
  message: string;
};

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "test_motivation",
    emoji: "🎯",
    label: "Test Motivation",
    category: "Engagement",
    icon: <Target size={16} />,
    accent: "from-orange-500 to-amber-500",
    notifType: "test",
    title: "Time to Test Your Knowledge! 🎯",
    message:
      "A new test is waiting for you. Students who practice regularly rank 3x higher. Open the app, take the test, and see where you stand today. Your rank won't improve by waiting — let's go!",
  },
  {
    id: "new_feature",
    emoji: "🚀",
    label: "New Feature Launch",
    category: "Announcement",
    icon: <Rocket size={16} />,
    accent: "from-violet-500 to-purple-600",
    notifType: "system",
    title: "Exciting New Feature Just Launched! 🚀",
    message:
      "We've added something new to RankPulse that will help you prepare smarter. Log in now to explore it and get ahead of the competition. Your feedback matters — let us know what you think!",
  },
  {
    id: "weekly_progress",
    emoji: "📊",
    label: "Weekly Progress Push",
    category: "Reminder",
    icon: <BarChart2 size={16} />,
    accent: "from-blue-500 to-cyan-600",
    notifType: "grade",
    title: "New Week — New Chance to Improve Your Rank! 📊",
    message:
      "A fresh week is here. Check your progress, review your weak areas, and aim for at least 3 tests this week. Consistency is what separates toppers from the rest. Let's make this week count!",
  },
  {
    id: "leaderboard_shoutout",
    emoji: "🏆",
    label: "Leaderboard Shoutout",
    category: "Recognition",
    icon: <Trophy size={16} />,
    accent: "from-yellow-500 to-amber-600",
    notifType: "grade",
    title: "This Week's Top Performers — Are You on the List? 🏆",
    message:
      "Congratulations to all students who made it to the leaderboard this week! Your hard work is paying off. For those who didn't — this is your sign to start now, climb the ranks, and make your name heard. The top spot is waiting!",
  },
  {
    id: "inactivity_nudge",
    emoji: "😴",
    label: "Inactivity Nudge",
    category: "Re-engagement",
    icon: <Moon size={16} />,
    accent: "from-slate-500 to-slate-600",
    notifType: "system",
    title: "We Miss You! Come Back and Keep Practicing 😴",
    message:
      "It's been a while since you last practiced on RankPulse. Your competitors haven't stopped — don't let the gap grow. Log in today, take a quick test, and get back on track. Even 20 minutes of focused practice makes a real difference.",
  },
  {
    id: "exam_countdown",
    emoji: "📅",
    label: "Exam Countdown",
    category: "Urgent",
    icon: <CalendarClock size={16} />,
    accent: "from-red-500 to-rose-600",
    notifType: "test",
    title: "Exam is Near — Every Single Day Counts! 📅",
    message:
      "The exam date is approaching fast. This is the time to go full throttle — revise your notes, attempt mock tests daily, and target your weak subjects first. No shortcuts now. Give it absolutely everything you have. You've got this!",
  },
  {
    id: "streak_congrats",
    emoji: "🔥",
    label: "Streak & Consistency",
    category: "Motivation",
    icon: <Flame size={16} />,
    accent: "from-orange-500 to-red-500",
    notifType: "system",
    title: "You're on a Roll — Keep the Streak Going! 🔥",
    message:
      "Consistency is the secret weapon of every topper. You've been showing up regularly — that's amazing! Don't break your streak. Keep at it and watch your rank climb steadily. We're rooting for you every step of the way!",
  },
  {
    id: "study_tip",
    emoji: "💡",
    label: "Study Tip / Strategy",
    category: "Tips",
    icon: <Lightbulb size={16} />,
    accent: "from-emerald-500 to-teal-600",
    notifType: "system",
    title: "Pro Tip: Try This Strategy in Your Next Test 💡",
    message:
      "Quick expert tip: Always attempt the topics you're most confident about first. It saves time, boosts your accuracy, and builds momentum. Try this in your next test and see the difference. Small smart habits lead to big rank jumps!",
  },
  {
    id: "contest_challenge",
    emoji: "🏅",
    label: "Contest / Challenge",
    category: "Event",
    icon: <Medal size={16} />,
    accent: "from-pink-500 to-rose-500",
    notifType: "test",
    title: "Special Challenge Live Now — Compete & Win! 🏅",
    message:
      "A brand new challenge has just launched on RankPulse! Compete with students from across the platform, climb the special leaderboard, and win exciting rewards. This is your chance to prove your preparation. Don't miss it — register now!",
  },
];

export default function SendNotification() {
  const { toast } = useToast();
  const [target, setTarget] = useState<Target>("all");
  const [notifType, setNotifType] = useState<NotifType>("system");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showTypes, setShowTypes] = useState(false);

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

  const applyTemplate = (tpl: EmailTemplate) => {
    setTitle(tpl.title);
    setMessage(tpl.message);
    setNotifType(tpl.notifType);
    setActiveTemplateId(tpl.id);
    setError("");
  };

  // Email Platform / Quota
  type EmailProvider = {
    key: string; providerName: string; providerSource: string; senderEmail: string;
    senderName: string; dailyLimit: number; usedToday: number; remainingDaily: number;
    lastSentAt: string | null; status: string; routingRole: string; maskedApiKey: string; isActive: boolean;
  };
  type EmailQuota = {
    usageDate: string;
    totals: { configuredProviders: number; totalUsedToday: number; totalRemainingDaily: number };
    providers: EmailProvider[];
    hourlyToday: { hour: string; sent: number; failed: number }[];
    daily7Days: { day: string; sent: number; failed: number }[];
  };
  const [emailQuota, setEmailQuota] = useState<EmailQuota | null>(null);
  const [loadingQuota, setLoadingQuota] = useState(true);
  const [quotaError, setQuotaError] = useState("");

  const fetchEmailQuota = async () => {
    setLoadingQuota(true);
    setQuotaError("");
    try {
      const res = await fetch(buildApiUrl(`/api/email-quota`), { credentials: "include" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any).error ?? "Failed"); }
      setEmailQuota(await res.json());
    } catch (err: any) { setQuotaError(err.message ?? "Failed to load email platform data"); }
    finally { setLoadingQuota(false); }
  };

  // Log filtering
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState<"all" | "sent" | "failed">("all");
  const [logTypeFilter, setLogTypeFilter] = useState("all");

  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[]>([]);
  const [loadingEmailOps, setLoadingEmailOps] = useState(true);
  const [emailOpsError, setEmailOpsError] = useState("");

  const [testEmailTo, setTestEmailTo] = useState("Rankpulsee@gmail.com");
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Email preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  // Editable fields inside the modal
  const [previewEditTitle, setPreviewEditTitle] = useState("");
  const [previewEditMessage, setPreviewEditMessage] = useState("");
  const [previewEditEmoji, setPreviewEditEmoji] = useState("📢");
  const [previewEditCategory, setPreviewEditCategory] = useState("Announcement");
  const [previewName, setPreviewName] = useState("Rahul Sharma");
  const [previewInactiveDays, setPreviewInactiveDays] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreviewHtml = useCallback(async (t: string, m: string, e: string, cat: string, pName: string, inactiveDaysStr: string) => {
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({ title: t, message: m, emoji: e, category: cat, previewName: pName });
      const inactiveDaysNum = parseInt(inactiveDaysStr, 10);
      if (!Number.isNaN(inactiveDaysNum) && inactiveDaysNum > 0) {
        params.set("inactiveDays", String(inactiveDaysNum));
      }
      const res = await fetch(buildApiUrl(`/api/notifications/email-preview?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("Preview fetch failed");
      const data = await res.json();
      setPreviewHtml(data.html ?? "");
    } catch (err: any) {
      setPreviewHtml(`<p style="color:red;font-family:sans-serif;padding:24px;">${err.message}</p>`);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  // Debounced re-render when editable fields change
  useEffect(() => {
    if (!previewOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPreviewHtml(previewEditTitle, previewEditMessage, previewEditEmoji, previewEditCategory, previewName, previewInactiveDays);
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [previewOpen, previewEditTitle, previewEditMessage, previewEditEmoji, previewEditCategory, previewName, previewInactiveDays, fetchPreviewHtml]);

  // Email broadcast
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailBroadcastResult, setEmailBroadcastResult] = useState<{ sent: number; failed: number } | null>(null);
  const [inactiveDaysThreshold, setInactiveDaysThreshold] = useState(7);

  // Recipients list
  type Recipient = { id: number; name: string; email: string; emailOptOut: boolean; inactiveDays: number | null };
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientsLoaded, setRecipientsLoaded] = useState(false);
  const [togglingOptOut, setTogglingOptOut] = useState<Set<number>>(new Set());

  const fetchRecipients = async () => {
    setLoadingRecipients(true);
    try {
      const res = await fetch(buildApiUrl(`/api/notifications/email-recipients`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRecipients(data.recipients ?? []);
      setRecipientsLoaded(true);
    } catch {
      setRecipientsLoaded(true);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const handleToggleEmailOptOut = async (recipientId: number, currentOptOut: boolean) => {
    setTogglingOptOut((prev) => new Set(prev).add(recipientId));
    try {
      const res = await fetch(buildApiUrl(`/api/notifications/email-opt-out/${recipientId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optOut: !currentOptOut }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setRecipients((prev) =>
        prev.map((r) => (r.id === recipientId ? { ...r, emailOptOut: !currentOptOut } : r)),
      );
      toast({
        title: !currentOptOut ? "Email blocked" : "Email unblocked",
        description: !currentOptOut ? "This student won't receive broadcast emails." : "This student will now receive broadcast emails.",
      });
    } catch {
      toast({ title: "Error", description: "Failed to update email preference.", variant: "destructive" });
    } finally {
      setTogglingOptOut((prev) => { const s = new Set(prev); s.delete(recipientId); return s; });
    }
  };

  const filteredRecipients = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
    );
  }, [recipients, recipientSearch]);

  // Filtered logs
  const logTypeOptions = useMemo(() => {
    const types = new Set(emailLogs.map((l) => l.messageType?.trim() || "transactional"));
    return Array.from(types).sort();
  }, [emailLogs]);

  const filteredLogs = useMemo(() => {
    return emailLogs.filter((log) => {
      if (logStatusFilter !== "all" && log.status !== logStatusFilter) return false;
      if (logTypeFilter !== "all" && (log.messageType?.trim() || "transactional") !== logTypeFilter) return false;
      if (logSearch.trim()) {
        const q = logSearch.trim().toLowerCase();
        if (!log.subject?.toLowerCase().includes(q) && !log.recipientEmail?.toLowerCase().includes(q) && !log.senderEmail?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [emailLogs, logStatusFilter, logTypeFilter, logSearch]);

  const selectedTarget = TARGETS.find((t) => t.value === target)!;
  const selectedType = TYPES.find((t) => t.value === notifType)!;

  const emailTypeChart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of emailLogs) {
      const key = log.messageType?.trim() || "transactional";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const rows = Array.from(counts.entries())
      .map(([type, count], index) => ({
        type,
        label: getEmailTypeLabel(type),
        count,
        color: EMAIL_TYPE_COLORS[index % EMAIL_TYPE_COLORS.length],
      }))
      .sort((left, right) => right.count - left.count);

    if (rows.length <= 6) {
      return rows;
    }

    const primaryRows = rows.slice(0, 5);
    const otherCount = rows.slice(5).reduce((sum, row) => sum + row.count, 0);
    return [
      ...primaryRows,
      {
        type: "other",
        label: "Other",
        count: otherCount,
        color: "#94A3B8",
      },
    ];
  }, [emailLogs]);
  const totalTypedEmails = useMemo(
    () => emailTypeChart.reduce((sum, row) => sum + row.count, 0),
    [emailTypeChart],
  );

  const handlePreviewEmail = (tpl: EmailTemplate) => {
    setPreviewTemplate(tpl);
    setPreviewEditTitle(tpl.title);
    setPreviewEditMessage(tpl.message);
    setPreviewEditEmoji(tpl.emoji);
    setPreviewEditCategory(tpl.category);
    setPreviewHtml("");
    setPreviewOpen(true);
    // actual fetch triggered by the useEffect debounce
  };

  const handleSendEmail = async () => {
    if (!title.trim()) { setError("Title is required."); return; }
    setError("");
    setEmailBroadcastResult(null);
    setSendingEmail(true);
    const tpl = previewTemplate ?? EMAIL_TEMPLATES.find((t) => t.id === activeTemplateId) ?? null;
    try {
      const res = await fetch(buildApiUrl(`/api/notifications/email-broadcast`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          emoji: tpl?.emoji ?? "📢",
          category: tpl?.category ?? "Announcement",
          target: target === "admins" ? "all" : target === "inactive" ? "inactive" : "students",
          ...(target === "inactive" ? { inactiveDaysThreshold } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error ?? "Failed to send emails");
      setEmailBroadcastResult({ sent: data.sent, failed: data.failed });
      toast({
        title: "Email broadcast sent",
        description: `Delivered to ${data.sent} student${data.sent !== 1 ? "s" : ""}${data.failed ? `, ${data.failed} failed` : ""}.`,
      });
      void fetchEmailOps();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong sending emails");
    } finally {
      setSendingEmail(false);
    }
  };

  const fetchEmailOps = async () => {
    setLoadingEmailOps(true);
    setEmailOpsError("");
    try {
      const logsRes = await fetch(buildApiUrl(`/api/notifications/email-log?limit=120`), {
        credentials: "include",
      });
      if (!logsRes.ok) {
        const payload = await logsRes.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to load email delivery log.");
      }
      const logsPayload = await logsRes.json();
      setEmailLogs(logsPayload.logs ?? []);
    } catch (err: any) {
      setEmailOpsError(err.message ?? "Failed to load email operations data.");
    } finally {
      setLoadingEmailOps(false);
    }
  };

  useEffect(() => {
    void fetchEmailOps();
    void fetchEmailQuota();
  }, []);

  const handleSend = async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError("");
    setSending(true);
    try {
      const res = await fetch(buildApiUrl(`/api/notifications/broadcast`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim() || undefined,
          link: link.trim() || undefined,
          type: notifType,
          target,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to send");
      }
      const data = await res.json();
      const entry: HistoryEntry = {
        target: selectedTarget.label,
        title: title.trim(),
        message: message.trim() || undefined,
        type: notifType,
        sent: data.sent,
        time: new Date(),
      };
      setHistory((h) => [entry, ...h].slice(0, 10));
      toast({
        title: "Notification sent",
        description: `Delivered to ${data.sent} user${data.sent !== 1 ? "s" : ""}.`,
      });
      setTitle("");
      setMessage("");
      setLink("");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailTo.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmailTo.trim())) {
      setTestEmailResult({ ok: false, message: "Valid email address required." });
      return;
    }
    setSendingTestEmail(true);
    setTestEmailResult(null);
    try {
      const res = await fetch(buildApiUrl(`/api/notifications/email-test`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmailTo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error ?? "Failed to send test email");
      setTestEmailResult({ ok: true, message: (data as any).message ?? `Test email sent to ${testEmailTo.trim()}` });
      void fetchEmailOps();
    } catch (err: any) {
      setTestEmailResult({ ok: false, message: err.message ?? "Failed to send test email" });
    } finally {
      setSendingTestEmail(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl min-w-0 space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#111827] via-[#7C2D12] to-[#F59E0B] p-5 text-white shadow-lg sm:p-6">
        <div className="relative z-10">
          <div className="mb-1 flex items-center gap-2 text-sm text-white/70">
            <Bell size={14} /> Notifications & Email Operations
          </div>
          <h1 className="text-2xl font-bold">Send Notification</h1>
          <p className="mt-1 text-sm text-white/75">
            Broadcast push updates to users and review email delivery history from one place.
          </p>
        </div>
        <div className="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-white/10" />
        <div className="absolute bottom-0 right-24 h-24 w-24 translate-y-8 rounded-full bg-white/10" />
      </div>

      {/* ── Email Platform Status ── */}
      <Card className="overflow-hidden">
        <div className="relative overflow-hidden bg-gradient-to-r from-[#0f172a] via-[#1e3a5f] to-[#0369a1] px-5 py-4 text-white">
          <div className="absolute right-0 top-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-white/5" />
          <div className="absolute bottom-0 right-16 h-20 w-20 translate-y-6 rounded-full bg-white/5" />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <Server size={18} />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">Email Platform</p>
                <p className="text-xs text-white/65 mt-0.5">Gmail SMTP provider status &amp; daily quota</p>
              </div>
            </div>
            <button
              onClick={() => void fetchEmailQuota()}
              disabled={loadingQuota}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={loadingQuota ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <CardContent className="pt-4 pb-4">
          {loadingQuota ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
            </div>
          ) : quotaError ? (
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangle size={13} className="mr-2" />
              <AlertDescription className="text-xs">{quotaError}</AlertDescription>
            </Alert>
          ) : !emailQuota || emailQuota.providers.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
                <WifiOff size={18} className="text-red-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-900">Email provider not configured</p>
                <p className="text-xs text-red-600 mt-0.5">GMAIL_USER aur GMAIL_APP_PASSWORD environment secrets set karo.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Provider cards */}
              {emailQuota.providers.map((p) => {
                const usedPct = p.dailyLimit > 0 ? Math.round((p.usedToday / p.dailyLimit) * 100) : 0;
                const barColor = usedPct >= 90 ? "#ef4444" : usedPct >= 70 ? "#f97316" : "#22c55e";
                const isActive = p.status === "active";
                return (
                  <div key={p.key} className="rounded-2xl border border-border bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-emerald-100" : "bg-red-100"}`}>
                          {isActive ? <Wifi size={18} className="text-emerald-600" /> : <WifiOff size={18} className="text-red-500" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-slate-900">{p.providerName}</p>
                            <Badge variant="outline" className={isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>
                              {isActive ? "Active" : p.status === "limit-reached" ? "Limit Reached" : "Inactive"}
                            </Badge>
                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 capitalize">{p.routingRole}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <AtSign size={10} /> {p.senderEmail} · <KeyRound size={10} /> {p.maskedApiKey}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-black text-slate-900">{p.usedToday}<span className="text-sm font-normal text-muted-foreground">/{p.dailyLimit}</span></p>
                        <p className="text-[11px] text-muted-foreground">emails sent today</p>
                      </div>
                    </div>
                    {/* Quota bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] text-muted-foreground">Daily quota</span>
                        <span className="text-[11px] font-semibold" style={{ color: barColor }}>{usedPct}% used · {p.remainingDaily} remaining</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(usedPct, 100)}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                    {p.lastSentAt && (
                      <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock3 size={10} /> Last sent: {formatDateTime(p.lastSentAt)}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Providers", value: emailQuota.totals.configuredProviders, icon: <Server size={14} />, color: "from-blue-500 to-indigo-600" },
                  { label: "Sent Today", value: emailQuota.totals.totalUsedToday, icon: <TrendingUp size={14} />, color: "from-emerald-500 to-teal-600" },
                  { label: "Remaining", value: emailQuota.totals.totalRemainingDaily, icon: <Activity size={14} />, color: "from-amber-500 to-orange-600" },
                ].map((stat) => (
                  <div key={stat.label} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-muted/30 px-3 py-3 text-center">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${stat.color} text-white`}>{stat.icon}</div>
                    <p className="text-xl font-black text-slate-900">{stat.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Hourly chart */}
              {emailQuota.hourlyToday.length > 0 && (
                <div className="rounded-2xl border border-border bg-white p-4">
                  <p className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5"><Activity size={12} className="text-[#D97706]" /> Today's Hourly Activity</p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={emailQuota.hourlyToday} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                        <Bar dataKey="sent" name="Sent" fill="#22c55e" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quick Templates ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap size={14} className="text-[#D97706]" /> Quick Templates
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Click any template to auto-fill the compose form. Customize before sending.
              </p>
            </div>
            {activeTemplateId && (
              <button
                onClick={() => { setActiveTemplateId(null); setTitle(""); setMessage(""); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EMAIL_TEMPLATES.map((tpl) => {
              const isActive = activeTemplateId === tpl.id;
              return (
                <div
                  key={tpl.id}
                  className={`group relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 transition-all duration-150 ${
                    isActive
                      ? "border-[#F59E0B] bg-[#FFF7E8] shadow-sm"
                      : "border-border hover:border-[#F59E0B]/50 hover:bg-muted/40"
                  }`}
                >
                  {isActive && (
                    <span className="absolute right-2 top-2">
                      <CheckCircle size={14} className="text-[#D97706]" />
                    </span>
                  )}
                  {/* Clickable header area fills template into form */}
                  <button
                    className="flex w-full flex-col items-start gap-2 text-left"
                    onClick={() => applyTemplate(tpl)}
                  >
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${tpl.accent} text-white shadow-sm`}>
                      {tpl.icon}
                    </div>
                    <div className="min-w-0 w-full pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold leading-tight">{tpl.emoji} {tpl.label}</span>
                      </div>
                      <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {tpl.category}
                      </span>
                      <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {tpl.message}
                      </p>
                    </div>
                  </button>
                  {/* Preview email button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); void handlePreviewEmail(tpl); }}
                    className="mt-1 flex items-center gap-1 rounded-lg border border-[#F59E0B]/40 bg-[#FFF7E8] px-2.5 py-1 text-[11px] font-medium text-[#B45309] transition-colors hover:border-[#F59E0B] hover:bg-[#FFEDD5]"
                  >
                    <Eye size={11} /> Preview Email
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Audience ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users size={14} className="text-[#D97706]" /> Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {TARGETS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTarget(t.value)}
                data-testid={`target-${t.value}`}
                className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all duration-150 ${
                  target === t.value
                    ? "border-[#F59E0B] bg-[#FFF7E8]"
                    : "border-border hover:border-[#F59E0B]/40 hover:bg-muted/50"
                }`}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${t.color} text-white shadow`}>
                  {t.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
                {target === t.value && (
                  <CheckCircle size={14} className="absolute right-2 top-2 text-[#D97706]" />
                )}
              </button>
            ))}
          </div>

          {/* Inactive threshold control */}
          {target === "inactive" && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <Timer size={16} className="shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">Inactive for at least</p>
                <p className="text-xs text-red-600">Sirf wahi students jinhe email jaayegi jo is se zyada din se inactive hain</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={inactiveDaysThreshold}
                  onChange={(e) => setInactiveDaysThreshold(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-16 rounded-lg border border-red-300 bg-white px-2 py-1.5 text-center text-sm font-semibold text-red-800 focus:border-red-500 focus:outline-none"
                />
                <span className="text-sm font-medium text-red-700">days</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-[#D97706]" /> Compose Message
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {error && (
              <Alert variant="destructive" className="py-2.5">
                <AlertTriangle size={14} className="mr-2" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1.5"><Tag size={13} /> Notification Type</Label>
              <div className="relative">
                <button
                  onClick={() => setShowTypes((v) => !v)}
                  data-testid="button-type-selector"
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring"
                >
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selectedType.color}`}>
                    {selectedType.label}
                  </span>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${showTypes ? "rotate-180" : ""}`} />
                </button>
                {showTypes && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
                    {TYPES.map((t) => (
                      <button
                        key={t.value}
                        className="flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-muted"
                        onClick={() => { setNotifType(t.value); setShowTypes(false); }}
                        data-testid={`type-option-${t.value}`}
                      >
                        <span className={`mr-3 rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1.5"><Bell size={13} /> Title <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. School is closed tomorrow"
                data-testid="input-notif-title"
                maxLength={100}
              />
              <p className="text-right text-xs text-muted-foreground">{title.length}/100</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Message <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add more context or details..."
                rows={3}
                className="resize-none"
                data-testid="input-notif-message"
                maxLength={500}
              />
              <p className="text-right text-xs text-muted-foreground">{message.length}/500</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1.5"><LinkIcon size={13} /> Link <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="e.g. /leaderboard"
                data-testid="input-notif-link"
              />
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-[#FFF7E8]/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-white">
                  <Bell size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{title || "Your notification title"}</p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${selectedType.color}`}>{selectedType.label}</span>
                  </div>
                  {message && <p className="text-xs text-muted-foreground">{message}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">→ {selectedTarget.label} · Just now</p>
                </div>
              </div>
            </div>

            {emailBroadcastResult && (
              <Alert className="border-green-200 bg-green-50 py-2.5">
                <CheckCircle size={14} className="text-green-600" />
                <AlertDescription className="text-green-700 text-xs">
                  Email broadcast complete — <strong>{emailBroadcastResult.sent}</strong> sent
                  {emailBroadcastResult.failed > 0 && `, ${emailBroadcastResult.failed} failed`}.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1 gap-2 bg-gradient-to-r from-[#F59E0B] to-[#D97706] hover:from-[#E28B06] hover:to-[#B45309]"
                onClick={handleSend}
                disabled={sending || !title.trim()}
                data-testid="button-send-notification"
              >
                {sending ? (
                  <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Sending…</>
                ) : (
                  <><Bell size={15} /> Push to {selectedTarget.label}</>
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2 border-[#F59E0B]/50 text-[#B45309] hover:border-[#F59E0B] hover:bg-[#FFF7E8]"
                onClick={handleSendEmail}
                disabled={sendingEmail || !title.trim()}
                data-testid="button-send-email"
              >
                {sendingEmail ? (
                  <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" /> Sending Email…</>
                ) : target === "inactive" ? (
                  <><Timer size={15} /> Email Inactive ({inactiveDaysThreshold}+ days)</>
                ) : (
                  <><Mail size={15} /> Email Students</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Email Preview Modal ── */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent
            className="p-0 overflow-hidden gap-0"
            style={{ maxWidth: "min(96vw, 1040px)", width: "96vw", maxHeight: "92vh" }}
          >
            {/* ── Top gradient header ── */}
            <div className="relative overflow-hidden bg-gradient-to-r from-[#1C1917] via-[#7C2D12] to-[#F59E0B] px-5 py-4 shrink-0">
              <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-white/10" />
              <div className="absolute bottom-0 right-24 h-16 w-16 translate-y-6 rounded-full bg-white/10" />
              <DialogHeader className="relative z-10">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white text-lg">
                      {previewEditEmoji || "📧"}
                    </div>
                    <div>
                      <DialogTitle className="text-white text-sm font-bold leading-tight">
                        Email Preview &amp; Editor
                      </DialogTitle>
                      <DialogDescription className="text-white/70 text-xs mt-0.5">
                        Text edit karo — right side mein live update hoga
                      </DialogDescription>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0 h-8 gap-1.5 text-xs bg-white text-[#B45309] hover:bg-white/90 font-semibold shadow"
                    onClick={() => {
                      setTitle(previewEditTitle);
                      setMessage(previewEditMessage);
                      if (previewTemplate) {
                        setActiveTemplateId(previewTemplate.id);
                        setNotifType(previewTemplate.notifType);
                      }
                      setPreviewOpen(false);
                      toast({ title: "Template applied", description: "Compose form mein copy ho gaya." });
                    }}
                  >
                    <Mail size={12} /> Apply to Form
                  </Button>
                </div>
              </DialogHeader>
            </div>

            {/* ── Split body ── */}
            <div className="flex overflow-hidden" style={{ height: "calc(92vh - 100px)" }}>

              {/* LEFT — editor panel */}
              <div className="w-80 shrink-0 flex flex-col border-r bg-background overflow-y-auto">
                {/* Emoji row */}
                <div className="px-4 pt-4 pb-3 border-b">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Emoji &amp; Category</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={previewEditEmoji}
                      onChange={(e) => setPreviewEditEmoji(e.target.value)}
                      className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-lg focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                      maxLength={4}
                      placeholder="📢"
                    />
                    <input
                      type="text"
                      value={previewEditCategory}
                      onChange={(e) => setPreviewEditCategory(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                      placeholder="Category badge"
                      maxLength={30}
                    />
                  </div>
                </div>

                {/* Title */}
                <div className="px-4 py-3 border-b">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                    Subject / Title
                  </label>
                  <textarea
                    value={previewEditTitle}
                    onChange={(e) => setPreviewEditTitle(e.target.value)}
                    rows={2}
                    maxLength={120}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                    placeholder="Email ka subject / heading…"
                  />
                  <p className="text-right text-[10px] text-muted-foreground mt-1">{previewEditTitle.length}/120</p>
                </div>

                {/* Message */}
                <div className="px-4 py-3 flex-1 flex flex-col">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                    Body Message
                  </label>
                  <textarea
                    value={previewEditMessage}
                    onChange={(e) => setPreviewEditMessage(e.target.value)}
                    maxLength={600}
                    className="flex-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                    style={{ minHeight: "160px" }}
                    placeholder="Students ko kya message jaayega…"
                  />
                  <p className="text-right text-[10px] text-muted-foreground mt-1">{previewEditMessage.length}/600</p>
                </div>

                {/* Preview persona */}
                <div className="px-4 py-3 border-t">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Preview Persona</p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Student Name (for Hi {"{name}"})</label>
                      <input
                        type="text"
                        value={previewName}
                        onChange={(e) => setPreviewName(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                        placeholder="e.g. Rahul Sharma"
                        maxLength={60}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Simulate Inactive Days (leave empty to hide)</label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={previewInactiveDays}
                        onChange={(e) => setPreviewInactiveDays(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                        placeholder="e.g. 10"
                      />
                    </div>
                  </div>
                </div>

                {/* Live indicator */}
                <div className="px-4 py-3 border-t bg-muted/20">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${loadingPreview ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
                    {loadingPreview ? "Re-rendering…" : "Live preview ready"}
                  </div>
                </div>
              </div>

              {/* RIGHT — email preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[#f3f4f6]">
                {/* Mock email client toolbar */}
                <div className="shrink-0 px-4 py-2.5 bg-white border-b shadow-sm">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <div className="flex gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-red-400" />
                      <span className="h-3 w-3 rounded-full bg-yellow-400" />
                      <span className="h-3 w-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 rounded-md bg-muted px-3 py-1 text-[10px] truncate">
                      <span className="font-medium text-foreground">From:</span> RankPulse &lt;noreply@rankpulse.in&gt;
                      <span className="mx-2">·</span>
                      <span className="font-medium text-foreground">To:</span> student@example.com
                      <span className="mx-2">·</span>
                      <span className="font-medium text-foreground">Sub:</span> {previewEditTitle || "…"}
                    </div>
                  </div>
                </div>

                {/* Iframe */}
                <div className="flex-1 overflow-auto relative">
                  {loadingPreview && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#f3f4f6]/80 backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-3">
                        <span className="h-8 w-8 animate-spin rounded-full border-3 border-border border-t-[#F59E0B]" style={{ borderWidth: "3px" }} />
                        <span className="text-xs text-muted-foreground font-medium">Rendering email…</span>
                      </div>
                    </div>
                  )}
                  {previewHtml ? (
                    <iframe
                      key={previewHtml}
                      srcDoc={previewHtml}
                      title="Email Preview"
                      className="w-full"
                      style={{ height: "100%", minHeight: "560px", border: "none", display: "block" }}
                      sandbox="allow-same-origin"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                      Koi preview nahi hai
                    </div>
                  )}
                </div>

                {/* Bottom bar */}
                <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-t">
                  <p className="text-[11px] text-muted-foreground">
                    ✉️ Yahi exact email students ke inbox mein jaayegi
                  </p>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-xs bg-gradient-to-r from-[#F59E0B] to-[#D97706] hover:from-[#E28B06] hover:to-[#B45309]"
                    onClick={() => {
                      setTitle(previewEditTitle);
                      setMessage(previewEditMessage);
                      if (previewTemplate) {
                        setActiveTemplateId(previewTemplate.id);
                        setNotifType(previewTemplate.notifType);
                      }
                      setPreviewOpen(false);
                    }}
                  >
                    <Mail size={11} /> Apply &amp; Close
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      {/* ── Email Recipients Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Users size={14} className="text-[#D97706]" /> Email Recipients
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Saare students jinhe "Email Students" button se email jaayegi — naam aur email ID ke saath.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {recipientsLoaded && (
                <Badge variant="outline" className="border-[#FDE7BE] bg-[#FFF7E8] text-[#B45309]">
                  {recipients.length} students
                </Badge>
              )}
              <button
                onClick={() => void fetchRecipients()}
                disabled={loadingRecipients}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-[#F59E0B]/50 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw size={11} className={loadingRecipients ? "animate-spin" : ""} />
                {recipientsLoaded ? "Refresh" : "Load"}
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {!recipientsLoaded && !loadingRecipients ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF7E8] border border-[#FDE7BE]">
                <Users size={20} className="text-[#D97706]" />
              </div>
              <div>
                <p className="text-sm font-medium">Recipients list load nahi hua abhi</p>
                <p className="text-xs text-muted-foreground mt-0.5">Load karo to dekhna kaun kaun students hain</p>
              </div>
              <button
                onClick={() => void fetchRecipients()}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#F59E0B] to-[#D97706] px-4 py-2 text-sm font-medium text-white hover:from-[#E28B06] hover:to-[#B45309] transition-all"
              >
                <Users size={14} /> Students Load Karo
              </button>
            </div>
          ) : loadingRecipients ? (
            <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground text-sm">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-[#F59E0B]" />
              Loading students…
            </div>
          ) : recipients.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Users size={28} className="opacity-30" />
              <p className="text-sm">Koi student nahi mila database mein.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search bar */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="Naam ya email se search karo…"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30 transition-colors"
                />
                {recipientSearch && (
                  <button
                    onClick={() => setRecipientSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Count */}
              <p className="text-xs text-muted-foreground">
                {filteredRecipients.length === recipients.length
                  ? `${recipients.length} students`
                  : `${filteredRecipients.length} of ${recipients.length} students`}
              </p>

              {/* List */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {filteredRecipients.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      "{recipientSearch}" se koi match nahi mila
                    </div>
                  ) : (
                    filteredRecipients.map((r, i) => {
                      const initials = r.name
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0].toUpperCase())
                        .join("");
                      const colors = [
                        "from-orange-400 to-amber-500",
                        "from-violet-400 to-purple-500",
                        "from-emerald-400 to-teal-500",
                        "from-blue-400 to-indigo-500",
                        "from-pink-400 to-rose-500",
                        "from-sky-400 to-cyan-500",
                      ];
                      const color = colors[i % colors.length];
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors ${r.emailOptOut ? "opacity-60" : ""}`}
                        >
                          {/* Avatar */}
                          <div
                            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${r.emailOptOut ? "from-gray-300 to-gray-400" : color} text-white text-xs font-bold select-none`}
                          >
                            {initials || "?"}
                            {r.emailOptOut && (
                              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500">
                                <Ban size={8} className="text-white" />
                              </span>
                            )}
                          </div>
                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium leading-tight truncate">{r.name}</p>
                              {r.emailOptOut && (
                                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">BLOCKED</span>
                              )}
                              {r.inactiveDays != null && r.inactiveDays >= 7 && !r.emailOptOut && (
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${r.inactiveDays >= 30 ? "bg-red-100 text-red-600" : r.inactiveDays >= 14 ? "bg-orange-100 text-orange-600" : "bg-yellow-100 text-yellow-700"}`}>
                                  {r.inactiveDays}d inactive
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                          </div>
                          {/* Block/Unblock email button */}
                          <button
                            onClick={() => void handleToggleEmailOptOut(r.id, r.emailOptOut)}
                            disabled={togglingOptOut.has(r.id)}
                            className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium border transition-colors ${
                              r.emailOptOut
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                            } disabled:opacity-50`}
                            title={r.emailOptOut ? "Unblock email" : "Block email"}
                          >
                            {togglingOptOut.has(r.id) ? (
                              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                            ) : r.emailOptOut ? (
                              <><CheckCircle size={9} /> Unblock</>
                            ) : (
                              <><Ban size={9} /> Block</>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send size={14} className="text-[#D97706]" /> Test Email
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Send a test email to verify that email delivery is working correctly.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="test-email-to" className="text-xs font-medium">Recipient Email</Label>
              <Input
                id="test-email-to"
                type="email"
                value={testEmailTo}
                onChange={(e) => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
                placeholder="test@example.com"
                className="text-sm"
              />
            </div>
            <Button
              className="shrink-0 gap-2 bg-gradient-to-r from-[#F59E0B] to-[#D97706] hover:from-[#E28B06] hover:to-[#B45309] sm:mb-0"
              onClick={() => void handleSendTestEmail()}
              disabled={sendingTestEmail}
            >
              {sendingTestEmail ? (
                <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Sending…</>
              ) : (
                <><Send size={14} /> Send Test</>
              )}
            </Button>
          </div>
          {testEmailResult && (
            <Alert variant={testEmailResult.ok ? "default" : "destructive"} className="py-2.5">
              {testEmailResult.ok
                ? <CheckCircle size={14} className="mr-2 text-emerald-600" />
                : <AlertTriangle size={14} className="mr-2" />}
              <AlertDescription className={testEmailResult.ok ? "text-emerald-700" : ""}>
                {testEmailResult.message}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail size={14} className="text-[#D97706]" /> Email Delivery Log
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Har email ka full audit trail — provider, sender, recipient, status aur type ke saath.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="border-[#FDE7BE] bg-[#FFF7E8] text-[#B45309]">
                {filteredLogs.length}/{emailLogs.length} entries
              </Badge>
              <button
                onClick={() => void fetchEmailOps()}
                disabled={loadingEmailOps}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-[#F59E0B]/50 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw size={11} className={loadingEmailOps ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
          </div>
          {/* Filters row */}
          {!loadingEmailOps && emailLogs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Subject, recipient ya sender…"
                  className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-3 text-xs focus:border-[#F59E0B] focus:outline-none focus:ring-1 focus:ring-[#F59E0B]/30"
                />
                {logSearch && (
                  <button onClick={() => setLogSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={10} /></button>
                )}
              </div>
              <select
                value={logStatusFilter}
                onChange={(e) => setLogStatusFilter(e.target.value as any)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:border-[#F59E0B] focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="sent">✅ Sent</option>
                <option value="failed">❌ Failed</option>
              </select>
              <select
                value={logTypeFilter}
                onChange={(e) => setLogTypeFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:border-[#F59E0B] focus:outline-none max-w-[180px]"
              >
                <option value="all">All Types</option>
                {logTypeOptions.map((t) => (
                  <option key={t} value={t}>{getEmailTypeLabel(t)}</option>
                ))}
              </select>
              {(logSearch || logStatusFilter !== "all" || logTypeFilter !== "all") && (
                <button
                  onClick={() => { setLogSearch(""); setLogStatusFilter("all"); setLogTypeFilter("all"); }}
                  className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-muted-foreground hover:border-red-300 hover:text-red-600 transition-colors"
                >
                  <X size={9} /> Clear
                </button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="rounded-2xl border border-[#FDE7BE] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Email Type Split</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recent email log ko type ke hisaab se yahan dekh sakte ho, jaise forgot password, verification, result ya report alerts.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-[#FDE7BE] bg-[#FFF7E8] text-[#B45309]">
                  {totalTypedEmails} tracked emails
                </Badge>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                  {emailTypeChart.length} types
                </Badge>
              </div>
            </div>

            {loadingEmailOps ? (
              <div className="mt-4 h-72 animate-pulse rounded-2xl bg-muted" />
            ) : emailTypeChart.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
                <p className="text-sm font-semibold">No email-type data yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Jaise hi forgot, verification, result ya kisi bhi type ka email jayega, yahan split dikhne lagega.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)] xl:items-center">
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={emailTypeChart}
                        dataKey="count"
                        nameKey="label"
                        innerRadius={58}
                        outerRadius={92}
                        paddingAngle={3}
                        stroke="#FFF7E8"
                        strokeWidth={3}
                      >
                        {emailTypeChart.map((entry) => (
                          <Cell key={entry.type} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name, payload) => {
                          const row = payload?.payload as { label: string } | undefined;
                          return [`${value} emails`, row?.label ?? "Email type"];
                        }}
                        contentStyle={{
                          borderRadius: 16,
                          border: "1px solid #FDE7BE",
                          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2.5">
                  {emailTypeChart.map((entry) => {
                    const share = totalTypedEmails > 0 ? Math.round((entry.count / totalTypedEmails) * 100) : 0;
                    return (
                      <div
                        key={entry.type}
                        className="rounded-2xl border border-border bg-[#FFFBF3] px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: entry.color }}
                              />
                              <p className="truncate text-sm font-semibold text-slate-900">{entry.label}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900">{entry.count}</p>
                            <p className="text-[11px] text-muted-foreground">{share}% share</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {loadingEmailOps ? (
            <div className="grid gap-3">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : emailLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
              <Mail size={18} className="mx-auto mb-2 text-[#D97706]" />
              <p className="text-sm font-semibold">No email activity yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Jaise hi koi email jaayega — reset, approval, rejection, ya escalation — yahan dikhai dega.
              </p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
              <Filter size={18} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-semibold">Koi match nahi mila</p>
              <p className="mt-1 text-xs text-muted-foreground">Filter ya search change karo.</p>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${log.status === "failed" ? "border-red-200 bg-red-50/30" : "border-border"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{log.subject}</p>
                      <Badge
                        variant="outline"
                        className={log.status === "sent"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-700"}
                      >
                        {log.status === "sent" ? "✓ Sent" : "✗ Failed"}
                      </Badge>
                      <Badge variant="outline" className="border-[#FDE7BE] bg-[#FFF7E8] text-[#B45309]">
                        {getEmailTypeLabel(log.messageType)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                      <span className="inline-flex items-center gap-1.5"><Mail size={11} className="shrink-0 text-[#D97706]" /> <span className="truncate">To: <strong className="text-slate-700">{log.recipientEmail}</strong></span></span>
                      <span className="inline-flex items-center gap-1.5"><AtSign size={11} className="shrink-0 text-[#D97706]" /> <span className="truncate">From: {log.senderEmail}</span></span>
                      <span className="inline-flex items-center gap-1.5"><Server size={11} className="shrink-0 text-[#D97706]" /> {log.providerName}</span>
                      <span className="inline-flex items-center gap-1.5"><KeyRound size={11} className="shrink-0 text-[#D97706]" /> {log.providerMaskedApiKey}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 size={11} className="shrink-0 text-[#D97706]" /> {formatDateTime(log.sentAt)}</span>
                    </div>
                    {log.errorMessage && (
                      <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-1.5">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle size={14} className="text-emerald-500" /> Sent This Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle size={13} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.title}</p>
                  {h.message && <p className="truncate text-xs text-muted-foreground">{h.message}</p>}
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{h.target}</Badge>
                    <span className="text-[10px] text-muted-foreground">{h.sent} recipients · {h.time.toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
