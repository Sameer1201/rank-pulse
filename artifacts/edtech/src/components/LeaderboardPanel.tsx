import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Medal, ClipboardList, Crown, Star, Zap, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readStudentExamSelection, studentExamLabel } from "@/lib/student-exam-selection";

interface LeaderboardEntry {
  id: number;
  fullName: string;
  username: string;
  avatarUrl?: string | null;
  points: number;
  rank: number;
  avgTestScore: number;
  questionBankScore: number;
  pyqScore: number;
  testsCompleted: number;
  questionBankAttempts: number;
  pyqAttempts: number;
}

const avatarGradients = [
  "from-violet-500 to-fuchsia-600",
  "from-blue-500 to-cyan-500",
  "from-rose-500 to-pink-600",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-indigo-500 to-blue-600",
];

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getShortName(value: string) {
  return value.split(" ")[0] ?? value;
}

function Avatar({
  avatarUrl,
  initials,
  name,
  rank,
  size = "md",
}: {
  avatarUrl?: string | null;
  initials: string;
  name: string;
  rank?: number;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-12 w-12 text-sm" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  const colorIndex = initials.charCodeAt(0) % avatarGradients.length;
  const ringClass = rank === 1
    ? "ring-2 ring-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.24)]"
    : rank === 2
      ? "ring-2 ring-slate-300 shadow-[0_0_18px_rgba(148,163,184,0.18)]"
      : rank === 3
        ? "ring-2 ring-orange-300 shadow-[0_0_18px_rgba(251,146,60,0.18)]"
        : "";

  return (
    <div className={`${sizeClass} ${ringClass} overflow-hidden rounded-full bg-gradient-to-br ${avatarGradients[colorIndex]} flex items-center justify-center font-bold text-white`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" decoding="async" />
      ) : (
        initials
      )}
    </div>
  );
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-4 w-4 text-amber-500" />;
  if (rank === 2) return <Trophy className="h-4 w-4 text-slate-400" />;
  if (rank === 3) return <Trophy className="h-4 w-4 text-orange-400" />;
  return <span className="text-xs font-bold text-slate-400">#{rank}</span>;
}

function TopThree({ entries }: { entries: LeaderboardEntry[] }) {
  const slots = [
    { entry: entries[1], rank: 2, height: "h-12", bar: "bg-slate-100 border-slate-300", badge: "bg-slate-300 text-slate-700" },
    { entry: entries[0], rank: 1, height: "h-16", bar: "bg-amber-100 border-amber-400", badge: "bg-amber-400 text-amber-950" },
    { entry: entries[2], rank: 3, height: "h-9", bar: "bg-orange-50 border-orange-300", badge: "bg-orange-400 text-orange-950" },
  ];

  return (
    <div className="leaderboard-podium flex items-end justify-center gap-2 border-b border-[#EEF2FF] bg-gradient-to-b from-[#F8FAFF] via-white to-white px-4 pb-4 pt-3">
      {slots.map((slot) => {
        if (!slot.entry) return <div key={slot.rank} className="flex-1" />;

        return (
          <div key={slot.entry.id} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative">
              {slot.rank === 1 ? (
                <motion.div
                  animate={{ scale: [1, 1.14, 1], opacity: [0.55, 1, 0.55] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -top-3 left-1/2 -translate-x-1/2"
                >
                  <Zap className="h-4 w-4 text-amber-400" />
                </motion.div>
              ) : null}
              <Avatar
                avatarUrl={slot.entry.avatarUrl}
                initials={getInitials(slot.entry.fullName)}
                name={slot.entry.fullName}
                rank={slot.rank}
                size={slot.rank === 1 ? "lg" : "md"}
              />
              <div className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black shadow ${slot.badge}`}>
                {slot.rank}
              </div>
            </div>
            <p className="text-center text-[11px] font-semibold leading-tight text-slate-700">{getShortName(slot.entry.fullName)}</p>
            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-300">{slot.entry.points} points</p>
            <div className={`w-full ${slot.height} rounded-t-md border-t-2 ${slot.bar} flex items-center justify-center`}>
              {slot.rank === 1 ? (
                <Crown className="h-4 w-4 text-amber-500" />
              ) : slot.rank === 2 ? (
                <Trophy className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <Medal className="h-3 w-3 text-orange-400" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StudentRow({
  entry,
  isCurrentUser = false,
  index = 0,
}: {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`flex items-center gap-2.5 px-3 py-2 ${
        isCurrentUser
          ? "mx-2 my-1 rounded-xl border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/60"
          : "border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-border dark:hover:bg-muted"
      }`}
    >
      <div className="flex w-6 flex-shrink-0 items-center justify-center">
        <RankIcon rank={entry.rank} />
      </div>
      <Avatar avatarUrl={entry.avatarUrl} initials={getInitials(entry.fullName)} name={entry.fullName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className={`truncate text-xs font-semibold ${isCurrentUser ? "text-violet-700 dark:text-violet-300" : "text-slate-800"}`}>
            {isCurrentUser ? "You" : entry.fullName}
          </p>
          {isCurrentUser ? (
            <span className="rounded-full bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-600 dark:bg-violet-900 dark:text-violet-200">You</span>
          ) : null}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-xs font-bold text-slate-800">{entry.points}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-300">points</p>
      </div>
    </motion.div>
  );
}

export default function LeaderboardPanel({ showLabel = true }: { showLabel?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeExam, setActiveExam] = useState(() => user?.role === "student" ? readStudentExamSelection(user) : "");
  useEffect(() => {
    if (user?.role !== "student") return;
    const sync = () => setActiveExam(readStudentExamSelection(user));
    window.addEventListener("student-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => { window.removeEventListener("student-exam-changed", sync); window.removeEventListener("storage", sync); };
  }, [user]);

  const { data: leaderboard = [], isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard-panel", activeExam],
    queryFn: () => api.get(`/leaderboard${activeExam ? `?exam=${encodeURIComponent(activeExam)}` : ""}`),
    enabled: open,
    staleTime: 30_000,
  });

  const topEntries = leaderboard.slice(0, 8);
  const podiumEntries = topEntries.slice(0, 3);
  const listEntries = topEntries.slice(3);
  const myEntry = user?.role === "student" ? leaderboard.find((entry) => entry.id === user.id) ?? null : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`relative flex items-center justify-center rounded-full border transition-all ${
            open
              ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-900/30"
              : "bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F8FAFF] hover:text-[#111827] dark:bg-card dark:border-border dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          } ${showLabel ? "gap-2 px-3 py-1.5 text-xs" : "h-9 w-9 p-2"}`}
          title="Leaderboard"
          data-testid={showLabel ? "button-top-leaderboard" : "button-top-leaderboard-mobile"}
        >
          <Trophy size={showLabel ? 14 : 16} />
          <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white" />
          {showLabel ? <span>Leaderboard</span> : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={12}
        collisionPadding={12}
        className="z-[80] w-[min(380px,calc(100vw-24px))] overflow-visible rounded-[24px] border border-[#E5E7EB] bg-white p-0 shadow-[0_32px_80px_rgba(15,23,42,0.18)] dark:border-border dark:bg-card"
      >
        <div className="absolute -top-2 right-4 h-4 w-4 rotate-45 rounded-tl-sm border-l border-t border-[#E5E7EB] bg-white" />

        <div className="border-b border-[#F1F5F9] px-4 pb-3 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-300">
                <Trophy className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight text-[#111827] dark:text-foreground">Leaderboard</p>
                <p className="text-[10px] text-[#6B7280] dark:text-muted-foreground">Top 8 {activeExam ? `${studentExamLabel(activeExam)} ` : "overall "}performers</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:bg-muted dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

        </div>

        {isLoading ? (
          <div className="space-y-3 px-4 py-4">
            <div className="h-28 animate-pulse rounded-2xl bg-[#F3F4F6]" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-2xl bg-[#F8FAFC]" />
            ))}
          </div>
        ) : topEntries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#6B7280]">
            <Trophy className="mx-auto mb-3 h-8 w-8 text-[#CBD5E1]" />
            No ranking data yet.
          </div>
        ) : (
          <>
            <TopThree entries={podiumEntries} />

            <div className="flex items-center gap-2 px-4 py-1.5">
              <div className="h-px flex-1 bg-gray-100 dark:bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-muted-foreground">Rankings</span>
              <div className="h-px flex-1 bg-gray-100 dark:bg-border" />
            </div>

            <div className="max-h-44 overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {listEntries.map((entry, index) => (
                  <StudentRow key={entry.id} entry={entry} index={index} />
                ))}
              </AnimatePresence>
            </div>

            {myEntry ? (
            <div className="border-t border-gray-100 bg-gray-50/70 px-2 pb-1 pt-1.5 dark:border-border dark:bg-muted/50">
                <div className="mb-1 flex items-center gap-1 px-2">
                  <Star className="h-2.5 w-2.5 text-violet-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">Your Position</span>
                </div>
                <StudentRow entry={myEntry} isCurrentUser />
              </div>
            ) : null}

            <div className="border-t border-gray-100 px-4 py-3">
              <p className="mb-2 text-[10px] text-slate-500 dark:text-muted-foreground">+1 per unique question attempted · Correct bonus: QBank +2, PYQ +3 · Plus test points</p>
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ClipboardList className="h-3 w-3" />
                  Live points ranking
                </span>
                <span>{leaderboard.length} students</span>
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
