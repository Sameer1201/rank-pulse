import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "interactive-3d flex min-h-[60px] w-full rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-2 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-md placeholder:text-muted-foreground transition-all duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary/50 focus-visible:-translate-y-0.5 focus-visible:shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_16px_38px_rgba(15,23,42,0.24)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
