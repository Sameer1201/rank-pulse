import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity, Clock, Users, Search, ChevronDown, ChevronUp, ArrowUpDown,
  GraduationCap, Shield, UserCheck, Eye, LogIn, BookOpen,
  MessageSquare, CalendarDays, Star, ClipboardList, Wifi, RefreshCw
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

interface ActivityLog {
  id: number;
  userId: number;
  action: string;
  page: string | null;
  detail: string | null;
  createdAt: string;
}

interface UserActivity {
  id: number;
  username: string;
  fullName: string;
  role: string;
  totalSeconds: number;
  sessionsCount: number;
  activityCount: number;
  testActivityCount: number;
  questionBankActivityCount: number;
  lastActiveAt: string | null;
  isOnline: boolean;
  recentActivities: ActivityLog[];
}

interface UserDetail {
  user: { id: number; username: string; fullName: string; role: string };
  totalSeconds: number;
  sessions: any[];
  activities: ActivityLog[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function actionIcon(action: string) {
  if (action === "login") return <LogIn size={13} className="text-green-600" />;
  if (action === "page_view") return <Eye size={13} className="text-blue-500" />;
  if (action.includes("test")) return <ClipboardList size={13} className="text-purple-500" />;
  if (action.includes("live") || action.includes("class")) return <BookOpen size={13} className="text-orange-500" />;
  if (action.includes("chat") || action.includes("community")) return <MessageSquare size={13} className="text-teal-500" />;
  if (action.includes("schedule")) return <CalendarDays size={13} className="text-indigo-500" />;
  if (action.includes("feedback")) return <Star size={13} className="text-yellow-500" />;
  return <Activity size={13} className="text-muted-foreground" />;
}

function roleIcon(role: string) {
  if (role === "super_admin") return <Shield size={14} className="text-red-500" />;
  if (role === "admin") return <UserCheck size={14} className="text-blue-600" />;
  return <GraduationCap size={14} className="text-green-600" />;
}

function roleBadge(role: string) {
  const colors: Record<string, string> = {
    super_admin: "bg-red-100 text-red-700 border-red-200",
    admin: "bg-blue-100 text-blue-700 border-blue-200",
    student: "bg-green-100 text-green-700 border-green-200",
  };
  const labels: Record<string, string> = { super_admin: "Super Admin", admin: "Teacher", student: "Student" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors[role] ?? "bg-muted"}`}>
      {roleIcon(role)}{labels[role] ?? role}
    </span>
  );
}

export default function UserActivityPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "student" | "super_admin">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"time" | "activity" | "tests" | "questionBank" | "sessions" | "name">("time");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data: overview = [], isLoading, refetch, isFetching } = useQuery<UserActivity[]>({
    queryKey: ["activity-overview"],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/activity/overview`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 120_000, // reduce repeated overview reads while keeping presence current
  });

  const { data: userDetail } = useQuery<UserDetail>({
    queryKey: ["activity-user", expandedId],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/activity/user/${expandedId}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: expandedId !== null,
  });

  const filtered = overview.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (onlineOnly && !u.isOnline) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === "name") {
      const result = a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    }
    const values = {
      time: [a.totalSeconds, b.totalSeconds],
      activity: [a.activityCount, b.activityCount],
      tests: [a.testActivityCount, b.testActivityCount],
      questionBank: [a.questionBankActivityCount, b.questionBankActivityCount],
      sessions: [a.sessionsCount, b.sessionsCount],
    }[sortBy];
    const result = values[0] - values[1] || a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
    return sortDirection === "asc" ? result : -result;
  });

  const onlineCount = overview.filter((u) => u.isOnline).length;
  const totalTimeAll = overview.reduce((s, u) => s + u.totalSeconds, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity size={22} className="text-primary" />User Activity</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor every user's actions, page visits, and time spent on the platform</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Users size={16} className="text-primary" /><span className="text-xs text-muted-foreground">Total Users</span></div>
            <p className="text-2xl font-bold">{overview.length}</p>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Wifi size={16} className="text-green-600" /><span className="text-xs text-muted-foreground">Online Now</span></div>
            <p className="text-2xl font-bold text-green-600">{onlineCount}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Clock size={16} className="text-blue-600" /><span className="text-xs text-muted-foreground">Total Time (All)</span></div>
            <p className="text-2xl font-bold text-blue-600">{formatDuration(totalTimeAll)}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Activity size={16} className="text-purple-600" /><span className="text-xs text-muted-foreground">Avg Time/User</span></div>
            <p className="text-2xl font-bold text-purple-600">
              {overview.length > 0 ? formatDuration(Math.floor(totalTimeAll / overview.length)) : "0s"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-9 text-sm" placeholder="Search by name or username..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {(["all", "super_admin", "admin", "student"] as const).map((r) => (
          <button key={r} onClick={() => setRoleFilter(r)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${roleFilter === r ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
            {r === "all" ? "All Roles" : r === "super_admin" ? "Super Admin" : r === "admin" ? "Teachers" : "Students"}
          </button>
        ))}
        <button onClick={() => setOnlineOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${onlineOnly ? "bg-green-600 text-white border-green-600" : "border-border hover:bg-muted"}`}>
          <Wifi size={12} />Online Only
        </button>
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1">
          <ArrowUpDown size={13} className="text-muted-foreground" />
          <select aria-label="Sort activity by" className="h-7 bg-transparent text-xs font-medium outline-none" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="time">Most used (time)</option>
            <option value="activity">Activity events</option>
            <option value="tests">Test activity</option>
            <option value="questionBank">Question Bank activity</option>
            <option value="sessions">Sessions</option>
            <option value="name">Name</option>
          </select>
          <select aria-label="Sort direction" className="h-7 bg-transparent text-xs font-medium outline-none" value={sortDirection} onChange={(e) => setSortDirection(e.target.value as typeof sortDirection)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      {/* User list */}
      {isLoading ? (
        <div className="text-center py-12"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-muted-foreground">Loading activity data...</p></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><Users size={32} className="mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No users match your filters</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const isExpanded = expandedId === u.id;
            return (
              <Card key={u.id} className={`transition-all ${u.isOnline ? "border-green-200" : ""}`}>
                <CardContent className="p-0">
                  {/* Row */}
                  <button
                    className="w-full text-left p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors rounded-xl"
                    onClick={() => setExpandedId(isExpanded ? null : u.id)}>
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${u.isOnline ? "bg-green-100 text-green-700 ring-2 ring-green-400" : "bg-primary/10 text-primary"}`}>
                      {u.fullName.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{u.fullName}</span>
                        {roleBadge(u.role)}
                        {u.isOnline && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />ONLINE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">@{u.username}</p>
                    </div>

                    {/* Stats */}
                    <div className="hidden md:flex items-center gap-6 shrink-0">
                      <div className="text-center">
                        <p className="text-sm font-bold">{formatDuration(u.totalSeconds)}</p>
                        <p className="text-[10px] text-muted-foreground">Time Spent</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold">{u.sessionsCount}</p>
                        <p className="text-[10px] text-muted-foreground">Sessions</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold">{u.testActivityCount}</p>
                        <p className="text-[10px] text-muted-foreground">Tests</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold">{u.questionBankActivityCount}</p>
                        <p className="text-[10px] text-muted-foreground">Q Bank</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">{timeAgo(u.lastActiveAt)}</p>
                        <p className="text-[10px] text-muted-foreground">Last Seen</p>
                      </div>
                    </div>

                    {/* Expand icon */}
                    <div className="text-muted-foreground shrink-0">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t px-4 pb-4 pt-3 space-y-3">
                      {/* Mobile stats */}
                      <div className="flex md:hidden items-center gap-4 text-center">
                        <div><p className="text-sm font-bold">{formatDuration(u.totalSeconds)}</p><p className="text-[10px] text-muted-foreground">Time Spent</p></div>
                        <div><p className="text-sm font-bold">{u.sessionsCount}</p><p className="text-[10px] text-muted-foreground">Sessions</p></div>
                        <div><p className="text-sm font-medium">{timeAgo(u.lastActiveAt)}</p><p className="text-[10px] text-muted-foreground">Last Seen</p></div>
                      </div>

                      {/* Session history */}
                      {userDetail && userDetail.user.id === u.id && userDetail.sessions.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Clock size={12} />Session History (last {Math.min(userDetail.sessions.length, 10)})</p>
                          <div className="space-y-1">
                            {userDetail.sessions.slice(0, 10).map((s: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${s.isActive ? "bg-green-400" : "bg-gray-300"}`} />
                                <span>{new Date(s.startedAt).toLocaleString()}</span>
                                <span className="text-primary font-medium">{formatDuration(s.totalSeconds || 0)}</span>
                                {s.isActive && <span className="text-green-600 font-medium">Active</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Full activity log */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Activity size={12} />Recent Activity</p>
                        {(userDetail?.user.id === u.id ? userDetail.activities : u.recentActivities).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No activity recorded yet</p>
                        ) : (
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {(userDetail?.user.id === u.id ? userDetail.activities : u.recentActivities).map((a, i) => (
                              <div key={i} className="flex items-start gap-2 py-1 border-b border-border/40 last:border-0">
                                <span className="mt-0.5 shrink-0">{actionIcon(a.action)}</span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-medium capitalize">{a.action.replace(/_/g, " ")}</span>
                                  {a.detail && <span className="text-xs text-muted-foreground ml-1">— {a.detail}</span>}
                                  {a.page && !a.detail && <span className="text-xs text-muted-foreground ml-1">{a.page}</span>}
                                </div>
                                <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{timeAgo(a.createdAt)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
