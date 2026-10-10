import { Info } from "lucide-react";

type QuestionAnalysisSummaryProps = {
  allottedTimeSeconds?: number | null;
  averageTimeSeconds?: number | null;
  gotRightPercent?: number | null;
  gotWrongPercent?: number | null;
  myTimeSeconds?: number | null;
  skippedPercent?: number | null;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatDuration(seconds: number | null | undefined) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  return `${safe}s`;
}

function formatPercent(value: number | null | undefined) {
  const safe = clampPercent(Number(value) || 0);
  return `${safe.toFixed(2)}%`;
}

export function QuestionAnalysisSummary({
  allottedTimeSeconds,
  averageTimeSeconds,
  gotRightPercent,
  gotWrongPercent,
  myTimeSeconds,
  skippedPercent,
}: QuestionAnalysisSummaryProps) {
  return (
    <div className="border-t border-[#E2E8F0] px-4 pb-4 pt-4">
      <div className="mx-auto max-w-[1360px] grid gap-3 xl:grid-cols-[1.18fr_1.18fr_0.62fr]">
        <div className="overflow-hidden rounded-[20px] border border-[#DCE5F2] bg-white">
          <div className="grid grid-cols-2">
            <div className="border-r border-[#E2E8F0]">
              <div className="border-b border-[#E2E8F0] px-4 py-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Time Spent</div>
                <div className="mt-1 text-[10px] font-medium text-[#6B7280]">Out of allotted time</div>
              </div>
              <div className="flex min-h-[78px] items-center justify-center px-4 py-4 text-center">
                <div className="text-[16px] font-bold text-[#111827]">
                  <span className="text-[#F97316]">{formatDuration(myTimeSeconds)}</span>
                  <span className="px-1 text-[#94A3B8]">/</span>
                  <span className="text-[#64748B]">{formatDuration(allottedTimeSeconds)}</span>
                </div>
              </div>
            </div>
            <div>
              <div className="border-b border-[#E2E8F0] px-4 py-3 text-center">
                <div className="inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">
                  Average Time
                  <Info className="h-3.5 w-3.5 text-[#4F46E5]" />
                </div>
              </div>
              <div className="flex min-h-[78px] items-center justify-center px-4 py-4 text-center">
                <div className="text-[16px] font-bold text-[#1F2937]">{formatDuration(averageTimeSeconds)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[20px] border border-[#DCE5F2] bg-white">
          <div className="grid grid-cols-2">
            <div className="border-r border-[#E2E8F0]">
              <div className="border-b border-[#E2E8F0] px-4 py-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Got It Right</div>
                <div className="mt-1 text-[10px] font-medium text-[#6B7280]">Out of those who attempted qs</div>
              </div>
              <div className="flex min-h-[78px] items-center justify-center px-4 py-4 text-center">
                <div className="text-[16px] font-bold text-[#22A55A]">{formatPercent(gotRightPercent)}</div>
              </div>
            </div>
            <div>
              <div className="border-b border-[#E2E8F0] px-4 py-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Got It Wrong</div>
                <div className="mt-1 text-[10px] font-medium text-[#6B7280]">Out of those who attempted qs</div>
              </div>
              <div className="flex min-h-[78px] items-center justify-center px-4 py-4 text-center">
                <div className="text-[16px] font-bold text-[#F43F5E]">{formatPercent(gotWrongPercent)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[20px] border border-[#DCE5F2] bg-white">
          <div className="border-b border-[#E2E8F0] px-4 py-3 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Skipped</div>
          </div>
          <div className="flex min-h-[78px] items-center justify-center px-4 py-4 text-center">
            <div className="text-[16px] font-bold text-[#1F2937]">{formatPercent(skippedPercent)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
