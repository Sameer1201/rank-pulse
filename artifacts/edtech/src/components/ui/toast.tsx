import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
	    ref={ref}
	    className={cn(
	      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-3 sm:bottom-4 sm:right-4 sm:top-auto sm:flex-col sm:p-0 md:max-w-[340px]",
	      className
	    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start gap-2 overflow-hidden rounded-[16px] border p-3 pr-9 shadow-[0_14px_34px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all after:absolute after:inset-y-3 after:left-0 after:w-0.5 after:rounded-r-full data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border-[#f4d8ae] bg-gradient-to-br from-white via-[#fffaf3] to-[#fff3dd] text-slate-950 after:bg-gradient-to-b after:from-[#F59E0B] after:to-[#D97706] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-slate-100 dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)]",
        success: "border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-[#fff7e8] text-emerald-950 after:bg-gradient-to-b after:from-emerald-400 after:to-[#D97706] dark:border-emerald-400/45 dark:from-[#102b24] dark:via-[#123a30] dark:to-[#222d22] dark:text-emerald-50 dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)] dark:after:from-emerald-300 dark:after:to-amber-300",
        warning: "border-amber-200 bg-gradient-to-br from-white via-[#fff7e8] to-amber-50 text-amber-950 after:bg-gradient-to-b after:from-[#F59E0B] after:to-amber-500 dark:border-amber-400/45 dark:from-[#352611] dark:via-[#3b2d15] dark:to-[#252116] dark:text-amber-50 dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)] dark:after:from-amber-300 dark:after:to-orange-300",
        info: "border-[#f4d8ae] bg-gradient-to-br from-white via-[#fffaf3] to-[#fff7e8] text-slate-950 after:bg-gradient-to-b after:from-[#F59E0B] after:to-[#D97706] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-slate-100 dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)]",
        destructive:
          "destructive group border-rose-200 bg-gradient-to-br from-white via-rose-50 to-red-50 text-rose-950 after:bg-gradient-to-b after:from-rose-500 after:to-red-500 dark:border-rose-400/45 dark:from-[#351b25] dark:via-[#3a1d25] dark:to-[#2b1b22] dark:text-rose-50 dark:shadow-[0_16px_40px_rgba(0,0,0,0.45)] dark:after:from-rose-300 dark:after:to-red-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-[#f0c88f] bg-white/70 px-3 text-sm font-semibold text-[#b45309] ring-offset-background transition-colors hover:bg-[#fff7e8] focus:outline-none focus:ring-2 focus:ring-[#F59E0B] focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-rose-200 group-[.destructive]:text-rose-700 group-[.destructive]:hover:bg-rose-50 group-[.destructive]:focus:ring-rose-400",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
	    ref={ref}
	    className={cn(
	      "absolute right-2 top-2 rounded-full p-1 text-slate-400 opacity-70 transition hover:bg-white/70 hover:text-slate-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#F59E0B] group-hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus:ring-offset-slate-900 group-[.destructive]:text-rose-400 group-[.destructive]:hover:text-rose-700 group-[.destructive]:focus:ring-rose-400 dark:group-[.destructive]:text-rose-300 dark:group-[.destructive]:hover:text-rose-100",
	      className
	    )}
    toast-close=""
    {...props}
  >
	    <X className="h-3.5 w-3.5" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
	  <ToastPrimitives.Title
	    ref={ref}
	    className={cn("text-[13px] font-extrabold tracking-tight", className)}
	    {...props}
	  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
	  <ToastPrimitives.Description
	    ref={ref}
	    className={cn("text-xs leading-4 text-slate-600 dark:text-slate-300 group-[.destructive]:text-rose-800/85 dark:group-[.destructive]:text-rose-200", className)}
	    {...props}
	  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
