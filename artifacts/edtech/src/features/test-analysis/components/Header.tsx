import { ArrowRight, Clock3, Layers3, Percent, Target, Trophy } from "lucide-react";

interface HeaderProps {
  title: string;
  summary?: {
    testTitle?: string;
    scoreLabel?: string;
    accuracyLabel?: string;
    percentileLabel?: string;
    attemptedLabel?: string;
    timeLabel?: string;
    rankLabel?: string;
  };
  onViewSolutions?: () => void;
  viewSolutionsDisabled?: boolean;
  compact?: boolean;
  showExpandTechnical?: boolean;
  expandTechnical?: boolean;
  onExpandTechnicalChange?: (value: boolean) => void;
}

const summaryItems = [
  { key: "scoreLabel", label: "Score", icon: Target },
  { key: "accuracyLabel", label: "Accuracy", icon: Percent },
  { key: "attemptedLabel", label: "Attempted", icon: Layers3 },
  { key: "timeLabel", label: "Time", icon: Clock3 },
  { key: "rankLabel", label: "Rank", icon: Trophy },
] as const;

function ExpandTechnicalButton({
  expandTechnical = false,
  onChange,
}: {
  expandTechnical?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!expandTechnical)}
      className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#475569] transition-colors hover:border-[#C7D2FE] hover:bg-[#F8FAFF]"
    >
      Expand Technical
      <span
        className={`relative inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
          expandTechnical ? "bg-[#F59E0B]" : "bg-[#E5E7EB]"
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            expandTechnical ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

export default function Header({
  title,
  summary,
  onViewSolutions,
  viewSolutionsDisabled = false,
  compact = false,
  showExpandTechnical = false,
  expandTechnical = false,
  onExpandTechnicalChange,
}: HeaderProps) {
  const technicalButton = showExpandTechnical ? (
    <ExpandTechnicalButton expandTechnical={expandTechnical} onChange={onExpandTechnicalChange} />
  ) : null;

  if (compact) {
    return (
      <div className="mb-5 rounded-[28px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:mb-6 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[1.55rem] font-bold leading-none tracking-[-0.03em] text-[#111827] sm:text-[2rem]">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {technicalButton}
            {onViewSolutions ? (
              <button
                onClick={onViewSolutions}
                disabled={viewSolutionsDisabled}
                className="chip-orange-solid inline-flex w-full items-center justify-center gap-2 self-start rounded-full px-6 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed sm:w-auto sm:self-auto"
              >
                View Solution
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-[28px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:mb-6 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6B7280]">Advanced Test Analysis</p>
          <h2 className="mt-2 text-xl font-bold text-[#111827] sm:text-[24px]">{title}</h2>
          {summary?.testTitle ? <p className="mt-1 text-sm text-[#6B7280]">{summary.testTitle}</p> : null}
          {summary?.percentileLabel ? (
            <div className="chip-orange-soft mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold">
              <Percent className="h-3.5 w-3.5" />
              Predicted {summary.percentileLabel}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {technicalButton}
          {onViewSolutions ? (
            <button
              onClick={onViewSolutions}
              disabled={viewSolutionsDisabled}
              className="chip-orange-solid flex w-full items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed sm:w-auto"
            >
              View Solution
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {summary ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {summaryItems
              .map(({ key, label, icon: Icon }) => {
                const value = summary[key];
                if (!value) return null;
                return (
                  <div key={key} className="rounded-2xl border border-[#EEF2FF] bg-[#FAFBFF] px-4 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">
                      <Icon className="h-3.5 w-3.5 text-[#D97706]" />
                      {label}
                    </div>
                    <p className="mt-2 text-base font-semibold text-[#111827]">{value}</p>
                  </div>
                );
              })
              .filter(Boolean)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
