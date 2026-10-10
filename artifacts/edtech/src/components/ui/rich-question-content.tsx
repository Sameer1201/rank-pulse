import { useMemo } from "react";
import "katex/dist/katex.min.css";

import { cn } from "@/lib/utils";
import { looksLikeRichHtmlContent, plainTextWithMath, sanitizeRichHtml, stripImageMarkers } from "@/lib/richContent";

interface RichQuestionContentProps {
  content?: string | null;
  className?: string;
}

export function RichQuestionContent({ content, className }: RichQuestionContentProps) {
  const value = looksLikeRichHtmlContent(content) ? content?.trim() ?? "" : stripImageMarkers(content?.trim() ?? "");
  const isRich = looksLikeRichHtmlContent(value) || /(?:\$[^$]+\$|\\[([]|\\(?:frac|sqrt|[a-zA-Z]+)|\^\{?[^\s}]+|_\{?[^\s}]+|\b[VvIi][A-Z]{1,3}(?=\s*(?:=|[,:;.]|$)))/.test(value);
  const sanitized = useMemo(() => (isRich ? sanitizeRichHtml(looksLikeRichHtmlContent(value) ? value : plainTextWithMath(value)) : ""), [isRich, value]);

  if (!value) return null;

  if (!isRich) {
    return <div className={cn("rich-question-content min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}>{value}</div>;
  }

  return (
    <div
      className={cn(
        "[&_.boolean-overline]:inline-block [&_.boolean-overline]:border-t [&_.boolean-overline]:border-current [&_.boolean-overline]:leading-tight",
        "rich-question-content min-w-0 max-w-full break-words whitespace-pre-wrap [overflow-wrap:anywhere] [&_p]:my-2 [&_p]:max-w-full [&_p]:whitespace-pre-wrap [&_p+div]:mt-2 [&_div]:max-w-full [&_div]:whitespace-pre-wrap [&_div+div]:mt-2 [&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full [&_img]:align-middle [&_img]:rounded-sm [&_img]:object-contain [&_table]:my-4 [&_table]:w-full [&_table]:min-w-0 [&_table]:table-fixed sm:[&_table]:table-auto [&_table]:max-w-full [&_table]:border-collapse [&_table]:text-left [&_th]:border [&_td]:border [&_th]:border-slate-300 [&_td]:border-slate-300 dark:[&_th]:border-slate-700 dark:[&_td]:border-slate-700 [&_th]:bg-slate-100 dark:[&_th]:bg-slate-800 [&_th]:px-1 [&_td]:px-1 sm:[&_th]:px-3 sm:[&_td]:px-3 [&_th]:py-2 [&_td]:py-2 [&_th]:font-semibold [&_th]:align-middle [&_td]:align-middle [&_table.match-layout_td]:w-1/2 [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.math-frac]:inline-flex [&_.math-frac]:align-middle [&_.math-frac]:flex-col [&_.math-frac]:text-center [&_.math-frac-num]:border-b [&_.math-frac-num]:border-current [&_.math-frac-den]:px-1",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
