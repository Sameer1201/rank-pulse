import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLogout } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQuestionBankTargetAlerts } from "@/hooks/useQuestionBankTargetAlerts";
import { buildApiUrl } from "@/lib/api-origin";
import StudentOnboardingGate from "@/components/student/StudentOnboardingGate";
import { BrandLogo } from "@/components/ui/brand-logo";
import { isStudentPendingVerification } from "@/lib/student-access";
import GateEceCountdown from "@/components/GateEceCountdown";
import {
  LayoutDashboard, Users, BookOpen,
  LogOut, Menu, X,
  ClipboardList, Activity,
  ChevronLeft, ChevronRight,
  Bell, Medal, CreditCard, Database,
  History, ShieldCheck,
  Building2, Sparkles,
} from "lucide-react";
import { FaTelegramPlane } from "react-icons/fa";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import AdminExamSelector from "@/components/admin/AdminExamSelector";
import StudentExamSelector from "@/components/student/StudentExamSelector";
import { isJamChemistryExam, readStudentExamSelection } from "@/lib/student-exam-selection";
import { readAdminExamSelection } from "@/lib/admin-exam-selection";
import { PageErrorBoundary, PageLoading } from "@/components/PageRecovery";
import {useTestAttemptResets} from '@/hooks/use-test-attempt-resets';

const NotificationBell = lazy(() => import("@/components/NotificationBell"));
const LeaderboardPanel = lazy(() => import("@/components/LeaderboardPanel"));
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const QuestionBankTargetPopup = lazy(() => import("@/components/QuestionBankTargetPopup"));

const TELEGRAM_GROUP_URL = "https://t.me/+VzBlWaU4DkNhZDFl";

interface NavItem { label: string; href: string; icon: React.ReactNode; }
interface NavGroup { label?: string; items: NavItem[]; }

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function getRoleConfig(role: string) {
  if (role === "super_admin") return { label: "Super Admin", iconBg: "bg-[#F97316]" };
  if (role === "admin") return { label: "Teacher", iconBg: "bg-[#F59E0B]" };
  return { label: "Student", iconBg: "bg-[#F97316]" };
}

function getNavIconTone(label: string) {
  const key = label.toLowerCase();
  if (key.includes("dashboard")) return "bg-[#FFF7E8] text-[#D97706]";
  if (key.includes("student") || key.includes("user")) return "bg-[#ECFDF5] text-[#22C55E]";
  if (key.includes("pyq")) return "bg-[#EEF2FF] text-[#6366F1]";
  if (key.includes("question") || key.includes("test")) return "bg-[#FFF7E8] text-[#F59E0B]";
  if (key.includes("analytics")) return "bg-[#FFF7ED] text-[#F97316]";
  if (key.includes("leaderboard") || key.includes("community") || key.includes("notification")) return "bg-[#FFF7E8] text-[#D97706]";
  return "bg-[#F3F4F6] text-[#6B7280]";
}

function getSuperAdminGroups(): NavGroup[] {
  return [
    { items: [{ label: "Dashboard", href: "/super-admin/dashboard", icon: <LayoutDashboard size={17} /> }] },
    { label: "Management", items: [
      { label: "Management", href: "/super-admin/management", icon: <Users size={17} /> },
    ]},
    { label: "Content", items: [
      { label: "Question Bank", href: "/super-admin/question-bank", icon: <BookOpen size={17} /> },
      { label: "Exam Templates", href: "/super-admin/exam-templates", icon: <ClipboardList size={17} /> },
      { label: "AI Hint Preview", href: "/super-admin/ai-hints", icon: <Sparkles size={17} /> },
    ]},
    { label: "Analytics", items: [
      { label: "Teacher Performance", href: "/super-admin/teacher-performance", icon: <Medal size={17} /> },
      { label: "Tests Overview", href: "/super-admin/tests", icon: <ClipboardList size={17} /> },
      { label: "User Activity", href: "/super-admin/activity", icon: <Activity size={17} /> },
      { label: "Payments", href: "/super-admin/payments", icon: <CreditCard size={17} /> },
    ]},
    { label: "Communication", items: [
      { label: "Send Notification", href: "/super-admin/send-notification", icon: <Bell size={17} /> },
    ]},
    { label: "Data", items: [
      { label: "Import / Export", href: "/super-admin/data-transfer", icon: <Database size={17} /> },
    ]},
  ];
}

function getAdminGroups(showPsu: boolean): NavGroup[] {
  return [
    { label: "Teaching", items: [
      { label: "Students", href: "/admin/students", icon: <Users size={17} /> },
      { label: "Question Bank", href: "/admin/question-bank", icon: <BookOpen size={17} /> },
      { label: "PYQ", href: "/admin/pyq", icon: <History size={17} /> },
      ...(showPsu ? [{ label: "PSU", href: "/admin/psu", icon: <Building2 size={17} /> }] : []),
      { label: "Tests", href: "/admin/tests", icon: <ClipboardList size={17} /> },
    ]},
  ];
}

function getStudentGroups(showPsu: boolean): NavGroup[] {
  return [
    { items: [{ label: "Dashboard", href: "/student/dashboard", icon: <LayoutDashboard size={17} /> }] },
    { label: "Learning", items: [
      { label: "Question Bank", href: "/student/question-bank", icon: <BookOpen size={17} /> },
      { label: "PYQ", href: "/student/pyq", icon: <History size={17} /> },
      ...(showPsu ? [{ label: "PSU", href: "/student/psu", icon: <Building2 size={17} /> }] : []),
      { label: "Tests", href: "/student/tests", icon: <ClipboardList size={17} /> },
    ]},
  ];
}

function NavLink({
  item,
  isActive,
  collapsed,
  onClick,
  blocked = false,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  blocked?: boolean;
}) {
  const iconTone = getNavIconTone(item.label);
  const classes = `relative flex items-center gap-3 rounded-[16px] text-sm transition-all duration-200 group border border-transparent ${
    collapsed ? "px-2.5 py-2.5 justify-center" : "px-3 py-2.5"
  } ${
    isActive
      ? "bg-[#F59E0B] text-white font-semibold shadow-[0_8px_18px_rgba(245,158,11,0.26)]"
      : "text-foreground/85 hover:bg-muted hover:text-foreground"
  }`;

  const content = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${isActive ? "border-white/10 bg-white text-[#D97706]" : `${iconTone} border-transparent group-hover:scale-105`}`}>
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && (
        <div className="absolute left-full ml-3 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground opacity-0 shadow-xl transition-all duration-150 pointer-events-none z-50 group-hover:opacity-100">
          {item.label}
          <div className="absolute top-1/2 -left-1 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-border bg-card" />
        </div>
      )}
    </>
  );

  if (blocked) {
    return (
      <button
        type="button"
        data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
        onClick={onClick}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
      onClick={onClick}
      className={classes}
    >
      {content}
    </Link>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  useTestAttemptResets(user?.role==='student'?user.id:null);
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const [studentExam, setStudentExam] = useState(() => readStudentExamSelection(user));
  const [adminExam, setAdminExam] = useState(() => readAdminExamSelection(location));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [topBarWidgetsReady, setTopBarWidgetsReady] = useState(false);
  const [commandPaletteReady, setCommandPaletteReady] = useState(false);
  const [telegramEntranceActive, setTelegramEntranceActive] = useState(false);
  const telegramEntranceUserRef = useRef<string | number | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();

  useEffect(() => {
    try { localStorage.setItem("sidebar-collapsed", String(collapsed)); } catch {}
  }, [collapsed]);

  useEffect(() => {
    const sync = () => setStudentExam(readStudentExamSelection(user));
    window.addEventListener("student-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => {
      window.removeEventListener("student-exam-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);

  useEffect(() => {
    const sync = () => setAdminExam(readAdminExamSelection(window.location.href));
    window.addEventListener("admin-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => {
      window.removeEventListener("admin-exam-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [location]);

  useEffect(() => {
    if (user?.role === "admin" && isJamChemistryExam(adminExam) && location.startsWith("/admin/psu")) {
      setLocation(`/admin/question-bank?exam=${encodeURIComponent(adminExam || "jam-chemistry")}`);
    }
  }, [adminExam, location, setLocation, user?.role]);

  useEffect(() => {
    const collapseForPractice = () => setCollapsed(true);
    window.addEventListener("rankpulse:collapse-sidebar", collapseForPractice);
    return () => window.removeEventListener("rankpulse:collapse-sidebar", collapseForPractice);
  }, []);

  const isDashboardRoute =
    location === "/student/dashboard" ||
    location === "/admin/dashboard" ||
    location === "/super-admin/dashboard";

  // The Telegram CTA is shown once per browser session. sessionStorage keeps a
  // refresh from replaying the animation while allowing a new tab/session to
  // show the welcome cue again.
  useEffect(() => {
    const userId = user?.id == null ? null : String(user.id);
    // Telegram is a student community CTA. Staff accounts must not get the
    // entrance animation or a stale animated icon from a previous session.
    if (!userId || user?.role !== "student" || isJamChemistryExam(studentExam)) {
      setTelegramEntranceActive(false);
      return;
    }

    if (!isDashboardRoute) {
      setTelegramEntranceActive(false);
      return;
    }

    const storageKey = `telegram-entrance-shown:${userId}`;
    try {
      if (sessionStorage.getItem(storageKey) === "true") return;
      sessionStorage.setItem(storageKey, "true");
    } catch {
      if (telegramEntranceUserRef.current === userId) return;
    }

    telegramEntranceUserRef.current = userId;
    setTelegramEntranceActive(true);
    const timeoutId = window.setTimeout(() => setTelegramEntranceActive(false), 1780);
    return () => window.clearTimeout(timeoutId);
  }, [user?.id, user?.role, studentExam, isDashboardRoute, location]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteReady(true);
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWidgets = () => {
      if (!cancelled) setTopBarWidgetsReady(true);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(loadWidgets, { timeout: 1500 });
      return () => {
        cancelled = true;
        if ("cancelIdleCallback" in window) {
          (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = globalThis.setTimeout(loadWidgets, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const userRole = user?.role;
  const isPendingStudent = isStudentPendingVerification(user);
  const showLeaderboardShortcut = userRole === "student" && !isPendingStudent;
  const showNotifications = !isPendingStudent;
  const accessQuery = useQuery<{ isClosed: boolean; closedUntil: string | null; priorityAccess?: boolean; aiAccess?: boolean }>({
    queryKey: ["student-access-window"],
    enabled: userRole === "student",
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/auth/registration-status"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load access window");
      return response.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const showPriorityBadge = userRole === "student" && accessQuery.isSuccess && accessQuery.data?.priorityAccess === true;
  const showAiBadge = userRole === "student" && accessQuery.isSuccess && accessQuery.data?.aiAccess === true && accessQuery.data?.priorityAccess !== true;
  const {
    alerts: questionBankAlerts,
    show: showQuestionBankPopup,
    dismiss: dismissQuestionBankAlerts,
  } = useQuestionBankTargetAlerts(
    user?.role === "admin" && location === "/admin/question-bank",
    user?.id,
  );

  if (!user) return <>{children}</>;

  const baseNavGroups =
    user.role === "super_admin" ? getSuperAdminGroups() :
    user.role === "admin" ? getAdminGroups(!isJamChemistryExam(adminExam)) :
    getStudentGroups(!isJamChemistryExam(studentExam));

  const navGroups = baseNavGroups;

  const roleConfig = getRoleConfig(user.role);
  const initials = getInitials(user.fullName ?? user.username ?? "?");
  const profileHref =
    user.role === "admin" ? "/admin/profile" :
    user.role === "student" ? "/student/profile" :
    null;

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => { logout(); queryClient.clear(); setLocation("/"); },
    });
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`border-b border-border px-4 py-4 ${collapsed ? "items-center" : ""}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
          <div className="flex min-w-0 items-center">
            <BrandLogo
              variant={collapsed ? "icon" : "wordmark"}
              imageClassName={collapsed ? "h-8" : "h-9 w-9"}
            />
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-0.5">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-3" : ""}>
            {!collapsed && group.label && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {group.label}
              </p>
            )}
            {collapsed && gi > 0 && group.label && (
              <div className="my-2 mx-auto h-px w-5 bg-border" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location === item.href || location.startsWith(item.href + "/");
                return (
                  <NavLink
                    key={item.href}
                    item={item}
                    isActive={isActive}
                    collapsed={collapsed}
                    onClick={() => {
                      setMobileOpen(false);
                      if (user.role === "student" && item.href === "/student/pyq") {
                        try { window.sessionStorage.setItem(`pyq-open-home:${user.id}`, "true"); } catch {}
                        window.dispatchEvent(new Event("rankpulse:pyq-home"));
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user + collapse */}
      <div className={`border-t border-border p-3 ${collapsed ? "space-y-3" : "space-y-1"}`}>
        {userRole === "student" && !isJamChemistryExam(studentExam) ? (
          <a
            href={TELEGRAM_GROUP_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="link-student-telegram"
            className={`group relative flex items-center rounded-xl border border-sky-200/80 bg-sky-50 text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:border-sky-400/50 dark:hover:bg-sky-950/55 ${collapsed ? "h-10 w-10 justify-center" : "gap-2.5 px-3 py-2.5"} ${telegramEntranceActive ? "telegram-entry-target" : ""}`}
            aria-label="Join the RankPulse Telegram community"
            title={collapsed ? "Join Telegram community" : undefined}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#229ED9] text-white shadow-sm">
              <FaTelegramPlane size={15} />
            </span>
            {!collapsed ? (
              <span className="min-w-0 truncate text-xs font-semibold">Join Telegram Community</span>
            ) : (
              <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                Join Telegram community
              </span>
            )}
          </a>
        ) : null}

        {/* User row */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <button
              type="button"
              onClick={() => profileHref && setLocation(profileHref)}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors ${profileHref ? "hover:bg-muted" : ""}`}
              title={profileHref ? "Open profile" : undefined}
            >
              {(user as any).avatarUrl ? (
                <img
                  src={(user as any).avatarUrl}
                  alt={user.fullName}
                  loading="lazy"
                  decoding="async"
                  className="w-8 h-8 rounded-full object-cover shrink-0 border-2 border-border"
                />
              ) : (
                <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white ${roleConfig.iconBg}`}>
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">{user.fullName}</p>
                <p className="truncate text-[11px] text-muted-foreground">@{user.username}</p>
              </div>
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                handleLogout();
              }}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-1">
            <button
              type="button"
              onClick={() => profileHref && setLocation(profileHref)}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${profileHref ? "hover:bg-muted" : ""}`}
              title={profileHref ? "Open profile" : undefined}
            >
              {(user as any).avatarUrl ? (
                <img
                  src={(user as any).avatarUrl}
                  alt={user.fullName}
                  loading="lazy"
                  decoding="async"
                  className="h-12 w-12 rounded-full border-2 border-border object-cover"
                />
              ) : (
                <div className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white ${roleConfig.iconBg}`}>
                  {initials}
                </div>
              )}
            </button>
            <button
              onClick={handleLogout}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`rounded-lg py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${collapsed ? "mx-auto flex h-8 w-8 items-center justify-center" : "flex w-full items-center justify-center gap-2"}`}
        >
          {collapsed ? <ChevronRight size={13} /> : <><ChevronLeft size={13} /><span>Collapse sidebar</span></>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {telegramEntranceActive && userRole === "student" && (
        <div className="pointer-events-none fixed inset-0 z-[70] hidden lg:block" aria-hidden="true">
          <div className={`telegram-flying-icon ${collapsed ? "telegram-flying-icon-collapsed" : "telegram-flying-icon-expanded"}`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#229ED9] text-white shadow-[0_12px_32px_rgba(34,158,217,0.42)] ring-4 ring-white/80 dark:ring-slate-950/80">
              <FaTelegramPlane size={22} />
            </span>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className={`relative z-10 hidden shrink-0 flex-col border-r border-border bg-card transition-all duration-200 lg:flex ${collapsed ? "w-[68px] overflow-visible" : "w-60 overflow-hidden"}`}>
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 flex ${collapsed ? "w-[68px]" : "w-[min(19rem,calc(100vw-1rem))]"} flex-col border-r border-border bg-card transition-[width,transform] duration-200 lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="sticky top-0 z-10 flex min-w-0 items-center gap-1.5 overflow-hidden border-b border-border bg-card/95 px-2.5 py-2.5 backdrop-blur sm:gap-2 sm:px-3 lg:hidden">
          <button onClick={() => setMobileOpen(!mobileOpen)} className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-menu">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex min-w-0 flex-1 items-center overflow-hidden sm:flex-initial">
            <BrandLogo variant="icon" className="shrink-0" imageClassName="h-8 w-8 sm:h-9 sm:w-9" />
          </div>
          {userRole === "admin" || userRole === "super_admin" ? <AdminExamSelector /> : userRole === "student" ? <StudentExamSelector /> : null}
          {showLeaderboardShortcut && (
            <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-1.5">
              {topBarWidgetsReady ? <GateEceCountdown compact /> : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
              {showPriorityBadge ? (
                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-700 shadow-sm sm:gap-1.5 sm:px-3 sm:text-xs" data-testid="priority-access-badge" aria-label="Priority access" title="Priority access">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> <span className="hidden sm:inline">Priority access</span>
                </div>
              ) : null}
              {showAiBadge ? (
                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] font-bold text-violet-700 shadow-sm sm:gap-1.5 sm:px-3 sm:text-xs" data-testid="ai-access-badge" aria-label="AI access" title="AI access">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" /> <span className="hidden sm:inline">AI access</span>
                </div>
              ) : null}
              <Suspense fallback={<div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}>
                {topBarWidgetsReady ? <LeaderboardPanel showLabel={false} /> : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
              </Suspense>
            </div>
          )}
          {showNotifications ? (
            <Suspense fallback={<div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}>
              {topBarWidgetsReady ? (
                <div className="flex items-center gap-1.5">
                  <NotificationBell />
                </div>
              ) : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
            </Suspense>
          ) : null}
          <ThemeToggle />
        </header>

        {/* Desktop topbar */}
        <header className="hidden shrink-0 items-center justify-end gap-2 border-b border-border bg-card px-6 py-2.5 lg:flex">
          {userRole === "admin" || userRole === "super_admin" ? <AdminExamSelector /> : userRole === "student" ? <StudentExamSelector /> : null}
          {showLeaderboardShortcut && (
            <div className="flex items-center gap-1.5">
              {topBarWidgetsReady ? <GateEceCountdown compact /> : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
              {showPriorityBadge ? (
                <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm" data-testid="priority-access-badge">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Priority access
                </div>
              ) : null}
              {showAiBadge ? (
                <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 shadow-sm" data-testid="ai-access-badge" aria-label="AI access" title="AI access">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" /> AI access
                </div>
              ) : null}
              <Suspense fallback={<div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}>
                {topBarWidgetsReady ? <LeaderboardPanel showLabel={false} /> : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
              </Suspense>
            </div>
          )}
          {showNotifications ? (
            <Suspense fallback={<div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}>
              {topBarWidgetsReady ? (
                <div className="flex items-center gap-1.5">
                  <NotificationBell />
                </div>
              ) : <div className="h-9 w-9 rounded-lg bg-[#F3F4F6]" />}
            </Suspense>
          ) : null}
          <ThemeToggle />
        </header>

        <main className={`flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-4 sm:pb-4 lg:p-6 ${user.role === "super_admin" ? "super-admin-theme" : ""}`}>
          <PageErrorBoundary resetKey={location}>
            <Suspense fallback={<PageLoading />}>{children}</Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Command Palette */}
      <Suspense fallback={null}>
        {commandPaletteReady ? <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} role={user.role} /> : null}
      </Suspense>

      <Suspense fallback={null}>
        {showQuestionBankPopup ? (
          <QuestionBankTargetPopup
            open={showQuestionBankPopup}
            alerts={questionBankAlerts}
            onDismiss={dismissQuestionBankAlerts}
            href="/admin/question-bank"
          />
        ) : null}
      </Suspense>
      {user?.role === "student" && location === "/student/profile" ? <StudentOnboardingGate /> : null}
    </div>
  );
}
