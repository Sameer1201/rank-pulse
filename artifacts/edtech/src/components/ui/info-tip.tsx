import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface InfoTipProps {
  content: string;
  label?: string;
}

export function InfoTip({ content, label = "More information" }: InfoTipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-[#94A3B8] transition hover:border-[#FED7AA] hover:text-[#F97316]"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs bg-[#111827] text-white">
        <p className="leading-relaxed">{content}</p>
      </TooltipContent>
    </Tooltip>
  );
}
