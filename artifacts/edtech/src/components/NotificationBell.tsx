import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Bell, Check, Trash2, X, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const typeColors: Record<string, string> = {
  assignment: "bg-orange-100 text-orange-700",
  grade:      "bg-green-100 text-green-700",
  test:       "bg-purple-100 text-purple-700",
  class:      "bg-blue-100 text-blue-700",
  community:  "bg-teal-100 text-teal-700",
  system:     "bg-slate-100 text-slate-600",
  digest:     "bg-indigo-100 text-indigo-700",
};

type BrowserWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasUserInteractedRef = useRef(false);
  const qc = useQueryClient();
  const { toast } = useToast();
    const playNotificationSound = () => {
    if (typeof window === "undefined") return;

    const AudioContextCtor = window.AudioContext || (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      if (!hasUserInteractedRef.current) return;
      void audioContext.resume().catch(() => {});
    }

    const startAt = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.4);

    const firstTone = audioContext.createOscillator();
    firstTone.type = "triangle";
    firstTone.frequency.setValueAtTime(880, startAt);
    firstTone.frequency.exponentialRampToValueAtTime(1174.66, startAt + 0.14);
    firstTone.connect(gain);
    firstTone.start(startAt);
    firstTone.stop(startAt + 0.16);

    const secondTone = audioContext.createOscillator();
    secondTone.type = "sine";
    secondTone.frequency.setValueAtTime(1318.51, startAt + 0.18);
    secondTone.connect(gain);
    secondTone.start(startAt + 0.18);
    secondTone.stop(startAt + 0.36);

    secondTone.onended = () => {
      gain.disconnect();
      firstTone.disconnect();
      secondTone.disconnect();
    };
  };

  /* ── Initial count via HTTP ── */
  const { data: countData, refetch: refetchCount } = useQuery<{ count: number }>({
    queryKey: ["notif-count"],
    queryFn: () => api.get("/notifications/unread-count"),
    refetchInterval: 5 * 60_000, // Light fallback poll; SSE handles real-time updates.
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  /* ── Notification list (loaded only when panel opens) ── */
  const { data: notifPage = { notifications: [] } } = useQuery<{ notifications: Notification[] }>({
    queryKey: ["notifications-bell"],
    queryFn: () => api.get("/notifications?limit=20"),
    enabled: open,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const notifications = notifPage.notifications ?? [];

  useEffect(() => {
    const markInteraction = () => {
      hasUserInteractedRef.current = true;
      if (audioContextRef.current?.state === "suspended") {
        void audioContextRef.current.resume().catch(() => {});
      }
    };

    window.addEventListener("pointerdown", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction);

    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
    };
  }, []);

  /* ── SSE real-time push ── */
  useEffect(() => {
    const url = buildApiUrl(`/api/notifications/stream`);
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource(url, { withCredentials: true } as any);

      es.addEventListener("notification", (e: MessageEvent) => {
        try {
          const notif: Notification = JSON.parse(e.data);

          // Bump unread count
          qc.setQueryData(["notif-count"], (old: { count: number } | undefined) => ({
            count: (old?.count ?? 0) + 1,
          }));

          // Invalidate list so panel refreshes on next open
          qc.invalidateQueries({ queryKey: ["notifications-bell"] });
          qc.invalidateQueries({ queryKey: ["activity-feed"] });

          // If a test was published, refresh the student test list immediately
          if (notif.type === "test") {
            qc.invalidateQueries({ queryKey: ["student-tests"] });
          }
          // Show toast
          playNotificationSound();
          toast({
            title: notif.title,
            description: notif.message ?? undefined,
          });
        } catch { /* ignore parse errors */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        // Retry after 5s
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [qc, toast]);

  /* ── Actions ── */
  const markRead = useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-bell"] });
      refetchCount();
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-bell"] });
      qc.setQueryData(["notif-count"], { count: 0 });
    },
  });

  const deleteNotif = useMutation({
    mutationFn: (id: number) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-bell"] });
      refetchCount();
    },
  });

  const unread = countData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#6B7280] transition-colors hover:bg-[#F5F7FB] hover:text-[#111827] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          data-testid="notification-bell"
          aria-label="Notifications"
        >
          <Bell size={18} className="text-current" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 animate-in fade-in-0 zoom-in-75"
              data-testid="notif-count"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        className="z-[80] w-[min(336px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-card p-0 shadow-2xl"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">
            Notifications {unread > 0 && <span className="text-primary">({unread})</span>}
          </h3>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Check size={12} /> All read
              </button>
            )}
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="max-h-[min(24rem,calc(100vh-120px))] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              <Bell size={28} className="mx-auto mb-2 opacity-30" />
              You're all caught up!
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
              >
                <div className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium mt-0.5 ${typeColors[n.type] ?? typeColors.system}`}>
                  {n.type}
                </div>
                <div className="flex-1 min-w-0">
                  {n.link ? (
                    <Link href={n.link} onClick={() => { markRead.mutate(n.id); setOpen(false); }}>
                      <p className={`text-sm leading-snug hover:text-primary ${!n.isRead ? "font-semibold" : ""}`}>{n.title}</p>
                    </Link>
                  ) : (
                    <p className={`text-sm leading-snug ${!n.isRead ? "font-semibold" : ""}`}>{n.title}</p>
                  )}
                  {n.message && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {!n.isRead && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      className="text-primary hover:text-primary/70"
                      title="Mark read"
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotif.mutate(n.id)}
                    className="text-red-400 hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border">
          <Link
            href="/activity"
            onClick={() => setOpen(false)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink size={11} /> View all activity
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
