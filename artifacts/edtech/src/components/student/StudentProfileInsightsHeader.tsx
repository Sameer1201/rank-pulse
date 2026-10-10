import { DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function StudentProfileInsightsHeader({ username }: { username?: string }) {
  return (
    <DialogHeader className="border-b bg-card px-6 py-5 text-card-foreground">
      <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
        <span>Student profile insights</span>
        {username && (
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-400">
            {username}
          </span>
        )}
      </DialogTitle>
    </DialogHeader>
  );
}
