import { cn } from "@/lib/utils";
import {
  TrendingUp,
  Clock,
  Target,
  BarChart2,
  Activity,
  GitBranch,
  AlignLeft,
  LayoutGrid,
  BrainCircuit,
} from "lucide-react";
import { testData } from "@/data/testData";

const personalNavItems = [
  { id: "overview",     label: "Overview",            icon: LayoutGrid  },
  { id: "advanced",     label: "Advanced Insights",   icon: BrainCircuit },
  { id: "performance",  label: "Performance Analysis", icon: TrendingUp  },
  { id: "time",         label: "Time Analysis",        icon: Clock       },
  { id: "attempt",      label: "Attempt Analysis",     icon: Target      },
  { id: "difficulty",   label: "Difficulty Analysis",  icon: BarChart2   },
  { id: "subject",      label: "Subject Movement",     icon: Activity    },
  { id: "journey",      label: "Question Journey",     icon: GitBranch   },
  { id: "qsbyqs",       label: "Qs by Qs Analysis",    icon: AlignLeft   },
];

const comparativeNavItems = [
  { id: "performance",  label: "Performance Analysis", icon: TrendingUp  },
  { id: "attempt",      label: "Attempt Analysis",     icon: Target      },
  { id: "time",         label: "Time Analysis",        icon: Clock       },
  { id: "difficulty",   label: "Difficulty Analysis",  icon: BarChart2   },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  mode: "personal" | "comparative";
  onModeChange: (m: "personal" | "comparative") => void;
  onBack?: () => void;
}

export default function Sidebar({ activeTab, onTabChange, mode, onModeChange, onBack }: SidebarProps) {
  const navItems = mode === "comparative" ? comparativeNavItems : personalNavItems;

  const handleModeChange = (newMode: "personal" | "comparative") => {
    onModeChange(newMode);
    if (newMode === "comparative") {
      const validIds = comparativeNavItems.map((i) => i.id);
      if (!validIds.includes(activeTab)) {
        onTabChange("performance");
      }
    }
  };

  return (
    <aside className="h-full w-[230px] flex-shrink-0 overflow-y-auto border-r border-[#ECEFF5] bg-white px-4 py-6">
      {onBack ? (
        <div className="mb-5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex w-full items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#475569] shadow-sm transition hover:border-[#CBD5E1] hover:bg-[#F8FAFC] hover:text-[#111827]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        </div>
      ) : null}
      <div className="mb-6">
        <h1 className="text-[18px] font-bold text-[#111827]">Test Analysis</h1>
        <p className="mt-0.5 text-xs font-medium text-[#6B7280]">{testData.testName}</p>
      </div>

      {/* Segmented toggle */}
      <div
        className="mb-6 flex items-center rounded-full p-1"
        style={{ background: "#F3F5F9" }}
      >
        <button
          onClick={() => handleModeChange("personal")}
          className="flex-1 flex items-center justify-center rounded-full py-1.5 text-sm font-semibold transition-all"
          style={
            mode === "personal"
              ? { background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", color: "#fff", boxShadow: "0 4px 10px rgba(217,119,6,0.28)" }
              : { background: "transparent", color: "#4B5563" }
          }
        >
          <span className="inline-flex items-center gap-2">
            Personal
            {mode === "personal" && (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
        <button
          onClick={() => handleModeChange("comparative")}
          className="flex-1 flex items-center justify-center rounded-full py-1.5 text-sm font-semibold transition-all"
          style={
            mode === "comparative"
              ? { background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", color: "#fff", boxShadow: "0 4px 10px rgba(217,119,6,0.28)" }
              : { background: "transparent", color: "#4B5563" }
          }
        >
          <span className="inline-flex items-center gap-2">
            Comparative
            {mode === "comparative" && (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
      </div>

      <nav className="flex flex-col gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-[18px] px-4 py-3.5 text-left text-sm font-semibold transition-all duration-150",
                isActive
                  ? "bg-[#1F2937] text-white shadow-[0_4px_14px_rgba(31,41,55,0.18)]"
                  : "text-[#1F2937] hover:bg-[#F3F5F9]"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-white" : "text-[#374151]")} />
                <span className="leading-tight">{item.label}</span>
              </div>
              <svg
                className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-white/80" : "text-[#374151]")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
