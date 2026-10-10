import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, BookOpen, GraduationCap, FlaskConical, Users, Megaphone,
  MessageCircle, Trash2, CheckCheck, Check, Filter, RefreshCw, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { buildApiUrl } from "@/lib/api-origin";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotifPage {
  notifications: Notification[];
  hasMore: boolean;
  nextCursor: number | null;
}

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  assignment: { label: "Assignment", icon: <BookOpen size={14} />, color: "text-orange-700", bg: "bg-orange-100" },
  grade:      { label: "Grade",      icon: <GraduationCap size={14} />, color: "text-green-700", bg: "bg-green-100" },
  test:       { label: "Test",       icon: <FlaskConical size={14} />, color: "text-purple-700", bg: "bg-purple-100" },
  class:      { label: "Class",      icon: <Users size={14} />,  color: "text-blue-700", bg: "bg-blue-100" },
  community:  { label: "Community",  icon: <MessageCircle size={14} />, color: "text-teal-700", bg: "bg-teal-100" },
  system:     { label: "System",     icon: <Megaphone size={14} />, color: "text-slate-600", bg: "bg-slate-100" },
  digest:     { label: "Digest",     icon: <BarChart3 size={14} />, color: "text-indigo-700", bg: "bg-indigo-100" },
};

const ALL_TYPES = ["all", "unread", ...Object.keys(TYPE_META)] as const;

function groupByDate(notifs: Notification[]): { label: string; items: Notification[] }[] {
  const groups: Record<string, Notification[]> = { Today: [], Yesterday: [], "This Week": [], Earlier: [] };
  for (const n of notifs) {
    const d = new Date(n.createdAt);
    if (isToday(d)) groups["Today"].push(n);
    else if (isYesterday(d)) groups["Yesterday"].push(n);
    else if (isThisWeek(d)) groups["This Week"].push(n);
    else groups["Earlier"].push(n);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function NotifCard({
  n, onRead, onDelete,
}: {
  n: Notification;
  onRead: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const meta = TYPE_META[n.type] ?? TYPE_META.system;
  return (
    <div
      className={`group flex gap-3 p-4 rounded-xl border transition-all ${
        n.isRead ? "border-border bg-card hover:bg-muted/30" : "border-primary/20 bg-primary/5 hover:bg-primary/8"
      }`}
    >
      {/* Type icon */}
      <div className={`shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center ${meta.bg} ${meta.color}`}>
        {meta.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            {n.link ? (
              <Link href={n.link} onClick={() => !n.isRead && onRead(n.id)}>
                <p className={`text-sm leading-snug hover:text-primary cursor-pointer ${!n.isRead ? "font-semibold" : ""}`}>
                  {n.title}
                </p>
              </Link>
            ) : (
              <p className={`text-sm leading-snug ${!n.isRead ? "font-semibold" : ""}`}>{n.title}</p>
            )}
            {n.message && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.message}</p>}
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium ${meta.bg} ${meta.color}`}>
                {meta.icon} {meta.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
              </span>
              {!n.isRead && (
                <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {!n.isRead && (
              <button
                onClick={() => onRead(n.id)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-primary"
                title="Mark as read"
              >
                <Check size={13} />
              </button>
            )}
            <button
              onClick={() => onDelete(n.id)}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-red-500"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ActivityFeed() {
  const [filter, setFilter] = useState<string>("all");
  const [allNotifs, setAllNotifs] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

    const fetchPage = useCallback(async (cur: number | null) => {
    const params = new URLSearchParams({ limit: "30" });
    if (cur) params.set("cursor", String(cur));
    const res = await fetch(buildApiUrl(`/api/notifications?${params}`), { credentials: "include" });
    return res.json() as Promise<NotifPage>;
  }, []);

  // Initial load
  const { data, isLoading, refetch } = useQuery<NotifPage>({
    queryKey: ["activity-feed"],
    queryFn: () => fetchPage(null),
  });

  useEffect(() => {
    if (data) {
      setAllNotifs(data.notifications);
      setHasMore(data.hasMore);
      setCursor(data.nextCursor);
    }
  }, [data]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      setAllNotifs((prev) => [...prev, ...page.notifications]);
      setHasMore(page.hasMore);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      await fetch(buildApiUrl(`/api/notifications/${id}/read`), { method: "PATCH", credentials: "include" });
    },
    onSuccess: (_, id) => {
      setAllNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      qc.invalidateQueries({ queryKey: ["notif-count"] });
    },
  });

  const deleteNotif = useMutation({
    mutationFn: async (id: number) => {
      await fetch(buildApiUrl(`/api/notifications/${id}`), { method: "DELETE", credentials: "include" });
    },
    onSuccess: (_, id) => {
      setAllNotifs((prev) => prev.filter((n) => n.id !== id));
      qc.invalidateQueries({ queryKey: ["notif-count"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch(buildApiUrl(`/api/notifications/read-all`), { method: "PATCH", credentials: "include" });
    },
    onSuccess: () => {
      setAllNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
      qc.invalidateQueries({ queryKey: ["notif-count"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const clearRead = useMutation({
    mutationFn: async () => {
      await fetch(buildApiUrl(`/api/notifications/clear-read`), { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      setAllNotifs((prev) => prev.filter((n) => !n.isRead));
      qc.invalidateQueries({ queryKey: ["notif-count"] });
      toast({ title: "Read notifications cleared" });
    },
  });

  // Filtered view
  const visible = allNotifs.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.isRead;
    return n.type === filter;
  });

  const grouped = groupByDate(visible);
  const unreadCount = allNotifs.filter((n) => !n.isRead).length;

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="text-primary" size={22} /> Activity Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allNotifs.length} notifications · {unreadCount} unread
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw size={13} /> Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} className="gap-1.5">
              <CheckCheck size={13} /> Mark all read
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => clearRead.mutate()} className="gap-1.5 text-red-500 hover:text-red-600">
            <Trash2 size={13} /> Clear read
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {ALL_TYPES.map((t) => {
          const count = t === "all" ? allNotifs.length
            : t === "unread" ? allNotifs.filter((n) => !n.isRead).length
            : allNotifs.filter((n) => n.type === t).length;
          const active = filter === t;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {t !== "all" && t !== "unread" && TYPE_META[t]?.icon}
              <span className="capitalize">{t === "unread" ? "Unread" : t === "all" ? "All" : TYPE_META[t]?.label ?? t}</span>
              {count > 0 && (
                <span className={`ml-0.5 min-w-[18px] h-[18px] text-[10px] rounded-full flex items-center justify-center px-1 ${
                  active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-foreground"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Bell size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">No notifications</p>
          <p className="text-sm mt-1">
            {filter === "all" ? "You're all caught up!" : `No ${filter} notifications`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ label, items }) => (
            <div key={label} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((n) => (
                  <NotifCard
                    key={n.id}
                    n={n}
                    onRead={(id) => markRead.mutate(id)}
                    onDelete={(id) => deleteNotif.mutate(id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="text-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
                {loadingMore ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Filter size={14} />
                )}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
