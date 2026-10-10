import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";

function getSecondsUntil(closedUntil: string | null) {
  if (!closedUntil) return 0;
  const timestamp = new Date(closedUntil).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : 0;
}

function formatCountdown(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${String(hours).padStart(2, "0")} : ${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
}

export function StudentAccessHoldScreen({
  closedUntil,
  registrationOnly = false,
  onExpired,
}: {
  closedUntil: string | null;
  registrationOnly?: boolean;
  onExpired?: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsUntil(closedUntil));
  const expiredNotified = useRef(false);

  useEffect(() => {
    setSecondsLeft(getSecondsUntil(closedUntil));
    const timer = window.setInterval(() => setSecondsLeft(getSecondsUntil(closedUntil)), 1000);
    return () => window.clearInterval(timer);
  }, [closedUntil]);

  useEffect(() => {
    if (secondsLeft > 0) {
      expiredNotified.current = false;
      return;
    }
    if (!expiredNotified.current) {
      expiredNotified.current = true;
      onExpired?.();
    }
  }, [onExpired, secondsLeft]);

  const finishLabel = useMemo(() => {
    if (!closedUntil) return "soon";
    return new Date(closedUntil).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }, [closedUntil]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fff7ed_0%,#ffffff_48%,#f8fafc_100%)] px-4 py-6 text-[#111827]">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl items-center justify-center">
        <div className="w-full rounded-[30px] border border-orange-100 bg-white p-7 text-center shadow-[0_26px_70px_rgba(15,23,42,0.1)] sm:p-10">
          <BrandLogo imageClassName="mx-auto h-11" />
          <div className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-50 text-orange-500">
            <Clock3 size={30} />
          </div>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            <ShieldCheck size={14} /> Priority access protected
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-900">
            {registrationOnly ? "Registration is paused" : "We’ll be back shortly"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
            {registrationOnly
              ? "New student registrations are temporarily closed while the team prepares the next access window."
              : "Access is temporarily paused for standard student accounts. Your account and progress are safe."}
          </p>
          <div className="mt-7 rounded-3xl border border-orange-100 bg-orange-50/70 px-5 py-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-700">Access resumes in</p>
            <p className="mt-3 font-mono text-3xl font-black tracking-tight text-slate-900 sm:text-4xl" data-testid="access-countdown">
              {secondsLeft > 0 ? formatCountdown(secondsLeft) : "Refreshing…"}
            </p>
            <p className="mt-3 text-xs text-slate-500">Expected by {finishLabel}</p>
          </div>
          {!registrationOnly && (
            <p className="mt-6 text-xs leading-5 text-slate-500">
              Students with priority access can continue without interruption.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
