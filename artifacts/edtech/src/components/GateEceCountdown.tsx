import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

const GATE_ECE_EXAM_TIME = new Date("2027-02-14T00:00:00+05:30").getTime();

export interface GateEceCountdownValue {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function getCountdown(): GateEceCountdownValue {
  const remainingMs = Math.max(0, GATE_ECE_EXAM_TIME - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);

  return {
    days: Math.floor(totalSeconds / (60 * 60 * 24)),
    hours: Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60)),
    minutes: Math.floor((totalSeconds % (60 * 60)) / 60),
    seconds: totalSeconds % 60,
  };
}

function useGateEceCountdown() {
  const [countdown, setCountdown] = useState(getCountdown);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountdown(getCountdown());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return countdown;
}

const countdownUnits = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
] as const;

function padded(value: number) {
  return String(value).padStart(2, "0");
}

export default function GateEceCountdown({ compact = false }: { compact?: boolean }) {
  const countdown = useGateEceCountdown();

  if (compact) {
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-200/80 bg-orange-50/70 px-2 py-1.5 text-orange-700 shadow-sm dark:border-orange-400/40 dark:bg-orange-950/35 dark:text-orange-300 sm:gap-2 sm:px-2.5"
        title="GATE ECE exam countdown"
        aria-label={`GATE ECE exam countdown: ${countdown.days} days, ${countdown.hours} hours, ${countdown.minutes} minutes, ${countdown.seconds} seconds remaining`}
      >
        <Timer className="h-3.5 w-3.5 shrink-0 text-orange-500 sm:h-4 sm:w-4" />
        <span className="hidden text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 sm:inline">GATE ECE</span>
        <span className="text-[10px] font-extrabold tabular-nums tracking-tight dark:text-orange-300 sm:hidden">
          {countdown.days}d {padded(countdown.hours)}h
        </span>
        <span className="hidden text-[10px] font-extrabold tabular-nums tracking-tight dark:text-orange-300 sm:inline sm:text-[11px]">
          {padded(countdown.days)}d {padded(countdown.hours)}h {padded(countdown.minutes)}m {padded(countdown.seconds)}s
        </span>
      </div>
    );
  }

  return (
    <div className="mb-4 max-w-sm rounded-2xl border border-orange-200/80 bg-white/75 p-2.5 shadow-sm backdrop-blur-sm dark:border-orange-400/30 dark:bg-card sm:p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold text-slate-800 dark:text-foreground sm:text-xs">
        <Timer className="h-3 w-3 text-orange-500 sm:h-3.5 sm:w-3.5" />
        GATE ECE exam countdown
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {countdownUnits.map((unit) => (
          <div key={unit.key} className="rounded-lg bg-orange-50/90 px-1 py-1.5 text-center dark:bg-orange-950/35 sm:px-2 sm:py-2">
            <div className="text-base font-extrabold tabular-nums text-orange-600 dark:text-orange-300 sm:text-xl">
              {padded(countdown[unit.key])}
            </div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground sm:text-xs sm:tracking-[0.18em]">
              {unit.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
