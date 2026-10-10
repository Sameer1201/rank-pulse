import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Medal } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const rankColors = ["text-yellow-500", "text-slate-400", "text-amber-600"];
const rankBg = ["bg-yellow-50 border-yellow-200", "bg-slate-50 border-slate-200", "bg-amber-50 border-amber-200"];
const medalIcons = [
  <Trophy size={20} className="text-yellow-500" />,
  <Medal size={20} className="text-slate-400" />,
  <Medal size={20} className="text-amber-600" />,
];

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function LeaderboardAvatar({ entry }: { entry: LeaderboardEntry }) {
  if (entry.avatarUrl) {
    return (
      <img
        src={entry.avatarUrl}
        alt={entry.fullName}
        className="h-11 w-11 rounded-full border border-border object-cover"
        decoding="async"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm font-bold text-white">
      {getInitials(entry.fullName)}
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth();
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
    queryKey: ["leaderboard", activeExam],
    queryFn: () => api.get(`/leaderboard${activeExam ? `?exam=${encodeURIComponent(activeExam)}` : ""}`),
    refetchInterval: 60_000,
  });

  const myEntry = user?.role === "student"
    ? leaderboard.find((entry) => entry.id === user.id)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trophy size={24} className="text-yellow-500" />
            Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeExam ? `${studentExamLabel(activeExam)} students · ` : ""}Earn points by attempting questions, solving them correctly and completing tests.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Each unique QBank/PYQ question: +1 for attempting, plus +2 for a correct QBank answer or +3 for a correct PYQ answer. Question points are awarded once; test points are added separately.</p>
        </div>
      </div>

      {myEntry ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
                #{myEntry.rank}
              </div>
              <div>
                <p className="font-semibold">Your Rank</p>
                <p className="text-sm text-muted-foreground">{myEntry.points} rank points</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : leaderboard.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Trophy size={40} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">
              No ranking data yet. Complete a Test, Q Bank or PYQ attempt to appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {leaderboard.map((entry) => {
            const isMe = entry.id === user?.id;
            const isTop3 = entry.rank <= 3;

            return (
              <Card
                key={entry.id}
                className={`transition-all ${isMe ? "ring-2 ring-primary" : ""} ${isTop3 ? rankBg[entry.rank - 1] : ""}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${isTop3 ? "" : "bg-muted text-muted-foreground"}`}>
                      {isTop3 ? medalIcons[entry.rank - 1] : <span className="text-base">#{entry.rank}</span>}
                    </div>
                    <LeaderboardAvatar entry={entry} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${isMe ? "text-primary" : ""}`}>{entry.fullName}</span>
                        {isMe ? <Badge className="text-xs">You</Badge> : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-2xl font-bold ${isTop3 ? rankColors[entry.rank - 1] : ""}`}>{entry.points}</p>
                      <p className="text-xs text-muted-foreground">points</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
