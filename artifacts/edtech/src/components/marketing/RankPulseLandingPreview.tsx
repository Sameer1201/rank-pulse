import { BarChart3 } from "lucide-react";

const attemptsData = [
  { week: "W1", you: 12, topper: 22, avg: 8 },
  { week: "W2", you: 18, topper: 28, avg: 10 },
  { week: "W3", you: 25, topper: 35, avg: 13 },
  { week: "W4", you: 34, topper: 42, avg: 17 },
  { week: "W5", you: 45, topper: 50, avg: 21 },
  { week: "W6", you: 58, topper: 60, avg: 26 },
];

const subjectRows = [
  { label: "General Aptitude", score: 92, max: 100, color: "#22c55e" },
  { label: "Technical", score: 81, max: 100, color: "#f97316" },
  { label: "Revision Bucket", score: 61, max: 100, color: "#3b82f6" },
];

const attemptMix = [
  { label: "Perfect", val: 20, max: 30, color: "#22c55e" },
  { label: "Wasted", val: 3, max: 30, color: "#ef4444" },
  { label: "Overtime", val: 5, max: 30, color: "#f97316" },
  { label: "Confused", val: 2, max: 30, color: "#6b7280" },
];

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-2.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function RankPulseLandingPreview() {
  return (
    <div className="grid w-full gap-4 lg:grid-cols-2">
      <div className="space-y-5 rounded-[28px] border border-gray-100 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.28em] text-indigo-600">Advanced Test Analysis</p>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-2xl font-extrabold text-gray-900">
              Performance
              <br />
              Analysis
            </h3>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">Personal</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Score", value: "226 / 300" },
            { label: "Percentile", value: "99.9+" },
            { label: "Time Taken", value: "111 min" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-gray-50 p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">{item.label}</p>
              <p className="text-lg font-extrabold text-gray-900">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-2xl bg-gray-50 p-4">
          <div>
            <p className="text-sm font-bold text-gray-800">Subject Breakdown</p>
            <p className="text-xs text-gray-400">Section-aware performance snapshot</p>
          </div>
          {subjectRows.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-gray-700">{item.label}</span>
                <span className="text-gray-500">
                  {item.score} / {item.max}
                </span>
              </div>
              <ProgressBar value={item.score} max={item.max} color={item.color} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-[28px] border border-gray-100 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.28em] text-indigo-600">Analysis Preview</p>
          <h3 className="text-2xl font-extrabold text-gray-900">Question Journey + Graphs</h3>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Students get performance, attempt, difficulty, and time analysis with visual graphs after every test.
          </p>
        </div>

        <div className="rounded-2xl bg-gray-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-gray-600">Attempts Over Time</span>
          </div>
          <svg viewBox="0 0 320 160" className="h-40 w-full">
            <path d="M20 130 L90 120 L150 95 L220 60 L300 40" fill="none" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
            <path d="M20 136 L90 132 L150 128 L220 118 L300 112" fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
            <path d="M20 138 L90 126 L150 108 L220 84 L300 58" fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
            {attemptsData.map((point, index) => {
              const xs = [20, 90, 150, 220, 300];
              const labels = ["W1", "W2", "W3", "W4", "W5", "W6"];
              return (
                <g key={point.week}>
                  <line x1={xs[index]} y1="22" x2={xs[index]} y2="140" stroke="#eceff5" strokeDasharray="4 6" />
                  <text x={xs[index]} y="152" textAnchor="middle" fontSize="10" fill="#9ca3af">
                    {labels[index]}
                  </text>
                </g>
              );
            })}
            {[40, 70, 100, 130].map((y) => (
              <line key={y} x1="20" y1={y} x2="300" y2={y} stroke="#eceff5" strokeDasharray="4 6" />
            ))}
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-2xl bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">Attempt Mix</p>
            {attemptMix.map((item) => (
              <div key={item.label} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-bold text-gray-800">{item.val}</span>
                </div>
                <MiniBar value={item.val} max={item.max} color={item.color} />
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">Time Quality</p>
            <div className="mt-4 h-4 overflow-hidden rounded-full bg-gray-200">
              <div className="flex h-full w-full">
                <div className="h-full bg-[#22c55e]" style={{ width: "64%" }} />
                <div className="h-full bg-[#f97316]" style={{ width: "18%" }} />
                <div className="h-full bg-[#cbd5e1]" style={{ width: "18%" }} />
              </div>
            </div>
            <div className="mt-3 space-y-2 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span>Time on correct</span>
                <span>71.2 min</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Time on incorrect</span>
                <span>19.8 min</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Time on unattempted</span>
                <span>20.0 min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
