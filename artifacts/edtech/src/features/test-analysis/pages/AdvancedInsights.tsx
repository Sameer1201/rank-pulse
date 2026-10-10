import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { BrainCircuit, Flame, Gauge, Sparkles } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { advancedInsightsData } from "@/data/testData";

type ViewKey = "forgetting" | "speed";

const speedMeta = {
  "fast-accurate": { label: "Best balance", color: "#16A34A", soft: "#DCFCE7" },
  "fast-fragile": { label: "Too fast", color: "#EA580C", soft: "#FFEDD5" },
  "slow-solid": { label: "Accurate but slow", color: "#2563EB", soft: "#DBEAFE" },
  "drag-zone": { label: "Needs reset", color: "#DC2626", soft: "#FEE2E2" },
} as const;

function formatSecondsLabel(seconds: number) {
  return `${Math.round(seconds)}s`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function TooltipCard({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
      {label ? <p className="text-sm font-semibold text-[#111827]">{label}</p> : null}
      <div className="mt-2 space-y-1.5 text-sm text-[#475569]">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.value}`} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color ?? "#F59E0B" }} />
            <span>{entry.name}: {entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shell({
  icon,
  title,
  eyebrow,
  children,
}: {
  icon: ReactNode;
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-[#E7EAF0] bg-white p-5 shadow-sm lg:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF7E8] text-[#D97706] shadow-sm">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9CA3AF]">{eyebrow}</p>
          <h3 className="mt-1 text-xl font-semibold text-[#111827]">{title}</h3>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-[#E5E7EB] bg-[#FCFCFD] px-5 py-12 text-center text-sm font-medium text-[#6B7280]">
      {title}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[#111827]">{value}</p>
      <p className="mt-1.5 text-sm text-[#6B7280]">{detail}</p>
    </div>
  );
}

function FeatureButton({
  active,
  icon,
  label,
  value,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-[28px] border px-4 py-4 text-left transition-all ${
        active
          ? "border-[#D97706] bg-[linear-gradient(135deg,#F59E0B_0%,#D97706_100%)] text-white shadow-[0_14px_32px_rgba(217,119,6,0.24)]"
          : "border-[#E7EAF0] bg-white text-[#111827] hover:border-[#FED7AA] hover:bg-[#FFFDF7]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? "bg-white/16 text-white" : "bg-[#FFF7E8] text-[#D97706]"}`}>
          {icon}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-white/16 text-white" : "bg-[#FFF7E8] text-[#B45309]"}`}>
          {value}
        </span>
      </div>
      <p className={`mt-4 text-base font-semibold ${active ? "text-white" : "text-[#111827]"}`}>{label}</p>
    </button>
  );
}

function ForgettingView() {
  const chartData = advancedInsightsData.forgettingCurve.map((item) => ({
    area: item.label,
    previous: item.previousAccuracy,
    current: item.currentAccuracy,
    retention: item.retentionPct,
  }));

  if (chartData.length === 0) return <EmptyState title="Not enough dip data was found for the forgetting curve." />;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-[28px] border border-[#EEF2F7] bg-[#FCFCFE] p-4">
        <div className="mb-4">
          <p className="text-sm font-semibold text-[#111827]">Retention drop tracker</p>
          <p className="text-sm text-[#6B7280]">The grey line shows the previous position, and the orange line shows the current retention drop.</p>
        </div>
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F7" />
              <XAxis dataKey="area" tick={{ fill: "#6B7280", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#6B7280", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<TooltipCard />} />
              <Line type="monotone" dataKey="previous" name="Previous" stroke="#94A3B8" strokeWidth={3} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="current" name="Current" stroke="#F59E0B" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3">
        {advancedInsightsData.forgettingCurve.map((item) => (
          <div key={`${item.subject}-${item.label}`} className="rounded-[28px] border border-[#FDE68A] bg-[#FFFCF3] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#111827]">{item.label}</p>
                <p className="mt-1 text-sm text-[#6B7280]">{item.subject}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#B45309]">
                -{item.drop} pts
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white px-3 py-3 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Prev</p>
                <p className="mt-2 text-lg font-bold text-[#111827]">{item.previousAccuracy}%</p>
              </div>
              <div className="rounded-2xl bg-white px-3 py-3 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Now</p>
                <p className="mt-2 text-lg font-bold text-[#111827]">{item.currentAccuracy}%</p>
              </div>
              <div className="rounded-2xl bg-white px-3 py-3 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Keep</p>
                <p className="mt-2 text-lg font-bold text-[#111827]">{item.retentionPct}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeedView() {
  const rows = [...advancedInsightsData.speedVsAccuracy].sort((left, right) => {
    const zoneRank = {
      "fast-accurate": 0,
      "slow-solid": 1,
      "fast-fragile": 2,
      "drag-zone": 3,
    } as const;

    return (
      zoneRank[left.zone] - zoneRank[right.zone]
      || right.accuracy - left.accuracy
      || left.avgSecondsPerAttempt - right.avgSecondsPerAttempt
    );
  });

  if (rows.length === 0) return <EmptyState title="Speed vs accuracy data is not available yet." />;

  const maxPace = Math.max(
    100,
    ...rows.map((item) => Math.max(item.avgSecondsPerAttempt, item.baselineSecondsPerAttempt ?? 0) + 10),
  );
  const bestAccuracy = [...rows].sort((left, right) => right.accuracy - left.accuracy)[0];
  const fastest = [...rows].sort((left, right) => left.avgSecondsPerAttempt - right.avgSecondsPerAttempt)[0];
  const needsReset = rows.find((item) => item.zone === "drag-zone") ?? rows[rows.length - 1];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <MetricCard
          label="Top Accuracy"
          value={bestAccuracy?.label ?? "NA"}
          detail={bestAccuracy ? `${bestAccuracy.accuracy}% correct` : "not available"}
        />
        <MetricCard
          label="Fastest Pace"
          value={fastest?.label ?? "NA"}
          detail={fastest ? `${formatSecondsLabel(fastest.avgSecondsPerAttempt)} per question` : "not available"}
        />
        <MetricCard
          label="Needs Fix"
          value={needsReset?.label ?? "NA"}
          detail={needsReset ? speedMeta[needsReset.zone].label : "not available"}
        />
      </div>

      <div className="rounded-[28px] border border-[#EEF2F7] bg-[#FCFCFE] p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#111827]">Simple pace tracker</p>
            <p className="mt-1 text-sm text-[#6B7280]">
              Each subject has one card: accuracy on top and the speed lane below. Left is faster, right is slower.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#DCFCE7] px-3 py-1 text-[#166534]">Fast</span>
            <span className="rounded-full bg-[#FEF3C7] px-3 py-1 text-[#B45309]">Balanced</span>
            <span className="rounded-full bg-[#FEE2E2] px-3 py-1 text-[#B91C1C]">Slow</span>
            <span className="rounded-full bg-white px-3 py-1 text-[#64748B] shadow-sm">Grey marker = previous pace</span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {rows.map((item) => {
            const meta = speedMeta[item.zone];
            const accuracyWidth = clampPercent(item.accuracy);
            const baselineAccuracyWidth = item.baselineAccuracy == null ? null : clampPercent(item.baselineAccuracy);
            const pacePosition = clampPercent((item.avgSecondsPerAttempt / maxPace) * 100);
            const baselinePacePosition = item.baselineSecondsPerAttempt == null
              ? null
              : clampPercent((item.baselineSecondsPerAttempt / maxPace) * 100);
            const accuracyDelta = item.baselineAccuracy == null ? null : Math.round((item.accuracy - item.baselineAccuracy) * 10) / 10;
            const paceDelta = item.baselineSecondsPerAttempt == null
              ? null
              : Math.round((item.avgSecondsPerAttempt - item.baselineSecondsPerAttempt) * 10) / 10;

            return (
              <div key={item.label} className="rounded-[28px] border border-[#E7EAF0] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-[#111827]">{item.label}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: meta.soft, color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-[#FFF7E8] px-3 py-1 text-xs font-semibold text-[#B45309]">
                        {formatSecondsLabel(item.avgSecondsPerAttempt)} / question
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Accuracy</p>
                    <p className="mt-1 text-2xl font-bold text-[#111827]">{item.accuracy}%</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Accuracy bar</p>
                      <span className="text-xs font-semibold text-[#6B7280]">
                        {accuracyDelta == null ? "Current test" : `${accuracyDelta >= 0 ? "+" : ""}${accuracyDelta}% vs previous`}
                      </span>
                    </div>
                    <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-[#E5E7EB]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${accuracyWidth}%`,
                          background: `linear-gradient(90deg, ${meta.soft} 0%, ${meta.color} 100%)`,
                        }}
                      />
                      {baselineAccuracyWidth != null ? (
                        <div
                          className="absolute inset-y-0 w-[2px] bg-[#94A3B8]"
                          style={{ left: `calc(${baselineAccuracyWidth}% - 1px)` }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-white px-3 py-1 text-[#111827] shadow-sm">{item.accuracy}% now</span>
                      {item.baselineAccuracy != null ? (
                        <span className="rounded-full bg-[#F8FAFC] px-3 py-1 text-[#64748B]">
                          {item.baselineAccuracy}% previous
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Speed lane</p>
                      <span className="text-xs font-semibold text-[#6B7280]">
                        {paceDelta == null ? "Current test" : `${paceDelta > 0 ? "+" : ""}${paceDelta}s vs previous`}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">
                      <span>Fast</span>
                      <span>Balanced</span>
                      <span>Slow</span>
                    </div>
                    <div className="relative mt-2 h-4 rounded-full bg-[linear-gradient(90deg,#DCFCE7_0%,#FEF3C7_48%,#FEE2E2_100%)]">
                      {baselinePacePosition != null ? (
                        <div
                          className="absolute -top-1 bottom-[-4px] w-[2px] rounded-full bg-[#94A3B8]"
                          style={{ left: `calc(${baselinePacePosition}% - 1px)` }}
                        />
                      ) : null}
                      <div
                        className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
                        style={{ left: `${pacePosition}%`, backgroundColor: meta.color }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-white px-3 py-1 text-[#111827] shadow-sm">
                        Current {formatSecondsLabel(item.avgSecondsPerAttempt)}
                      </span>
                      {item.baselineSecondsPerAttempt != null ? (
                        <span className="rounded-full bg-[#F8FAFC] px-3 py-1 text-[#64748B]">
                          Previous {formatSecondsLabel(item.baselineSecondsPerAttempt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AdvancedInsights() {
  const [activeView, setActiveView] = useState<ViewKey>("forgetting");

  const featureCards = useMemo(
    () => [
      { key: "forgetting" as const, label: "Forgetting Curve", value: `${advancedInsightsData.forgettingCurve.length}`, icon: <Flame className="h-5 w-5" /> },
      { key: "speed" as const, label: "Speed vs Accuracy", value: `${advancedInsightsData.speedVsAccuracy.length}`, icon: <Gauge className="h-5 w-5" /> },
    ],
    [],
  );

  const activeTitle = activeView === "forgetting" ? "Forgetting Curve" : "Speed vs Accuracy";
  const bestZone = advancedInsightsData.speedVsAccuracy.find((item) => item.zone === "fast-accurate")?.label ?? "Not enough data";
  const biggestDrop = advancedInsightsData.forgettingCurve[0]?.label ?? "No major drop";

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-[34px] border border-[#FDE7C4] bg-[linear-gradient(135deg,#FFF7E8_0%,#FFFFFF_46%,#FFF8EE_100%)] p-5 shadow-sm lg:p-6">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FED7AA] bg-white px-4 py-2 text-sm font-semibold text-[#B45309]">
              <BrainCircuit className="h-4 w-4" />
              {advancedInsightsData.historyDepth > 0
                ? `${advancedInsightsData.historyDepth} recent test${advancedInsightsData.historyDepth === 1 ? "" : "s"} analysed`
                : "History building"}
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">Advanced Insights</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#6B7280]">
              Two high-signal views only: memory retention drop and the pace-quality map.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-[#111827] shadow-sm">
              <Sparkles className="h-4 w-4 text-[#D97706]" />
              Currently viewing {activeTitle}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="History" value={advancedInsightsData.historyDepth} detail="recent tests used" />
            <MetricCard label="Biggest Drop" value={biggestDrop} detail="current weakest memory signal" />
            <MetricCard label="Best Zone" value={bestZone} detail="speed-quality sweet spot" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {featureCards.map((item) => (
            <FeatureButton
              key={item.key}
              active={activeView === item.key}
              icon={item.icon}
              label={item.label}
              value={item.value}
              onClick={() => setActiveView(item.key)}
            />
          ))}
        </div>
      </section>

      {activeView === "forgetting" ? (
        <Shell icon={<Flame className="h-5 w-5" />} eyebrow="Focused View" title="Forgetting Curve">
          <ForgettingView />
        </Shell>
      ) : null}

      {activeView === "speed" ? (
        <Shell icon={<Gauge className="h-5 w-5" />} eyebrow="Focused View" title="Speed vs Accuracy">
          <SpeedView />
        </Shell>
      ) : null}
    </div>
  );
}
