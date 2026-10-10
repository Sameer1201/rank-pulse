import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"

type ToastTone = "success" | "warning" | "destructive" | "info"

function readToastText(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return ""
}

function getToastTone(variant: unknown, title: unknown, description: unknown): ToastTone {
  if (variant === "destructive") return "destructive"

  const content = `${readToastText(title)} ${readToastText(description)}`.toLowerCase()
  if (/(failed|failure|error|could not|invalid|denied|rejected)/.test(content)) return "destructive"
  if (/(warning|skipped|pending|review|attention|duplicate)/.test(content)) return "warning"
  if (/(published|unpublished|saved|updated|created|deleted|removed|sent|approved|restored|enabled|disabled|imported|exported|submitted|complete|success)/.test(content)) return "success"
  return "info"
}

const toastToneStyles: Record<ToastTone, {
  root: string
  icon: string
  Icon: typeof CheckCircle2
}> = {
  success: {
    root: "border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-[#fff7e8] after:from-emerald-400 after:to-[#D97706] dark:border-emerald-400/45 dark:from-[#102b24] dark:via-[#123a30] dark:to-[#222d22] dark:after:from-emerald-300 dark:after:to-amber-300",
    icon: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/35",
    Icon: CheckCircle2,
  },
  warning: {
    root: "border-amber-200 bg-gradient-to-br from-white via-[#fff7e8] to-amber-50 after:from-[#F59E0B] after:to-amber-500 dark:border-amber-400/45 dark:from-[#352611] dark:via-[#3b2d15] dark:to-[#252116] dark:after:from-amber-300 dark:after:to-orange-300",
    icon: "bg-[#FFF7E8] text-[#D97706] ring-amber-200 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/35",
    Icon: AlertTriangle,
  },
  destructive: {
    root: "border-rose-200 bg-gradient-to-br from-white via-rose-50 to-red-50 after:from-rose-500 after:to-red-500 dark:border-rose-400/45 dark:from-[#351b25] dark:via-[#3a1d25] dark:to-[#2b1b22] dark:after:from-rose-300 dark:after:to-red-300",
    icon: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-400/15 dark:text-rose-200 dark:ring-rose-400/35",
    Icon: XCircle,
  },
  info: {
    root: "border-[#f4d8ae] bg-gradient-to-br from-white via-[#fffaf3] to-[#fff7e8] after:from-[#F59E0B] after:to-[#D97706] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800",
    icon: "bg-[#FFF7E8] text-[#D97706] ring-orange-200 dark:bg-slate-800 dark:text-orange-200 dark:ring-orange-400/35",
    Icon: Info,
  },
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, className, ...props }) {
        const tone = getToastTone(variant, title, description)
        const toneStyle = toastToneStyles[tone]
        const Icon = toneStyle.Icon

        return (
          <Toast key={id} variant={variant} className={cn(toneStyle.root, className)} {...props}>
            <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ring-1", toneStyle.icon)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              {title && <ToastTitle className="pr-3">{title}</ToastTitle>}
              {description && (
                <ToastDescription className="mt-0.5 line-clamp-2">{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
