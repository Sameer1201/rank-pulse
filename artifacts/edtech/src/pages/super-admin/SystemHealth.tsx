import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, RefreshCw, Clock,
  Database, Flame, Mail, CreditCard, Activity,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

interface ServiceResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

interface HealthResponse {
  status: "healthy" | "degraded";
  checkedAt: string;
  services: {
    database: ServiceResult;
    firebase: ServiceResult;
    gmail: ServiceResult;
    razorpay: ServiceResult;
  };
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  database: <Database size={22} />,
  firebase: <Flame size={22} />,
  gmail:    <Mail size={22} />,
  razorpay: <CreditCard size={22} />,
};

const SERVICE_COLORS: Record<string, string> = {
  database: "bg-blue-50 text-blue-600 border-blue-100",
  firebase: "bg-orange-50 text-orange-500 border-orange-100",
  gmail:    "bg-red-50 text-red-500 border-red-100",
  razorpay: "bg-indigo-50 text-indigo-600 border-indigo-100",
};

function LatencyBadge({ ms }: { ms: number }) {
  const color = ms < 300 ? "text-emerald-600 bg-emerald-50" : ms < 800 ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>
      <Clock size={11} />{ms}ms
    </span>
  );
}

function ServiceCard({ id, service }: { id: string; service: ServiceResult }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`rounded-xl border p-2.5 ${SERVICE_COLORS[id] ?? "bg-gray-50 text-gray-500 border-gray-100"}`}>
            {SERVICE_ICONS[id]}
          </span>
          <div>
            <p className="font-semibold text-gray-800 leading-tight">{service.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{id.toUpperCase()}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {service.ok ? (
            <span className="flex items-center gap-1 text-emerald-600 font-semibold text-sm">
              <CheckCircle2 size={17} /> Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-500 font-semibold text-sm">
              <XCircle size={17} /> Offline
            </span>
          )}
          <LatencyBadge ms={service.latencyMs} />
        </div>
      </div>
      <div className={`rounded-lg px-3 py-2 text-xs font-mono break-all leading-relaxed ${service.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
        {service.detail}
      </div>
    </div>
  );
}

export default function SystemHealth() {
  const [manualRefresh, setManualRefresh] = useState(0);

  const { data, isLoading, isFetching, error, refetch } = useQuery<HealthResponse>({
    queryKey: ["system-health", manualRefresh],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/system-health`), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const handleRefresh = () => {
    setManualRefresh((n) => n + 1);
    refetch();
  };

  const allOk = data?.status === "healthy";
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : null;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity size={24} className="text-[#F97316]" /> System Health
          </h1>
          <p className="text-sm text-gray-500 mt-1">Live status of all connected services</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F97316] text-white text-sm font-medium shadow hover:bg-[#ea6c0a] transition disabled:opacity-60"
        >
          <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          {isFetching ? "Checking…" : "Refresh"}
        </button>
      </div>

      {/* Overall status banner */}
      {data && (
        <div className={`rounded-2xl px-5 py-4 flex items-center justify-between gap-4 shadow-sm border ${allOk ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
          <div className="flex items-center gap-3">
            {allOk
              ? <CheckCircle2 size={28} className="text-emerald-500 shrink-0" />
              : <XCircle size={28} className="text-red-500 shrink-0" />
            }
            <div>
              <p className={`font-bold text-lg ${allOk ? "text-emerald-700" : "text-red-700"}`}>
                {allOk ? "All Systems Operational" : "One or More Services Degraded"}
              </p>
              {checkedAt && (
                <p className="text-xs text-gray-500 mt-0.5">Last checked at {checkedAt}</p>
              )}
            </div>
          </div>
          <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full ${allOk ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {data.status}
          </span>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-white p-5 shadow-sm h-32 animate-pulse">
              <div className="flex gap-3 items-start">
                <div className="w-11 h-11 rounded-xl bg-gray-100" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="rounded-2xl bg-red-50 border border-red-100 px-5 py-4 text-red-700 text-sm">
          Failed to fetch health status. Make sure you are logged in as Super Admin.
        </div>
      )}

      {/* Service cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(data.services).map(([id, service]) => (
            <ServiceCard key={id} id={id} service={service} />
          ))}
        </div>
      )}

      {/* Auto-refresh note */}
      <p className="text-center text-xs text-gray-400">Auto-refreshes every 60 seconds</p>
    </div>
  );
}
