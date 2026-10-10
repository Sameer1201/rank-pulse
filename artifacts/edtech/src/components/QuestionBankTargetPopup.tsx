import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Bell, CheckSquare, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { QuestionBankAlert } from "@/hooks/useQuestionBankTargetAlerts";
import { format, formatDistanceToNow } from "date-fns";

function urgencyConfig(urgency: QuestionBankAlert["urgency"]) {
  if (urgency === "overdue") {
    return {
      bg: "bg-red-50",
      border: "border-red-300",
      icon: <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />,
      label: "OVERDUE",
      labelClass: "bg-red-500 text-white",
      timeClass: "text-red-600",
    };
  }
  if (urgency === "critical") {
    return {
      bg: "bg-orange-50",
      border: "border-orange-300",
      icon: <AlertTriangle size={15} className="text-orange-500 shrink-0 mt-0.5" />,
      label: "CRITICAL",
      labelClass: "bg-orange-500 text-white",
      timeClass: "text-orange-600",
    };
  }
  return {
    bg: "bg-amber-50",
    border: "border-amber-300",
    icon: <Clock size={15} className="text-amber-500 shrink-0 mt-0.5" />,
    label: "DUE SOON",
    labelClass: "bg-amber-500 text-white",
    timeClass: "text-amber-600",
  };
}

interface Props {
  open: boolean;
  alerts: QuestionBankAlert[];
  onDismiss: () => void;
  href: string;
}

export default function QuestionBankTargetPopup({ open, alerts, onDismiss, href }: Props) {
  const worstFirst = [...alerts].sort((a, b) => {
    const order = { overdue: 0, critical: 1, warning: 2 };
    return order[a.urgency] - order[b.urgency];
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
              <Bell size={14} className="text-violet-600" />
            </div>
            Question Bank Target Alert
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {alerts.length} card{alerts.length > 1 ? "s" : ""} pending
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5 mt-1 max-h-80 overflow-y-auto pr-1">
          {worstFirst.map((alert) => {
            const cfg = urgencyConfig(alert.urgency);
            return (
              <div key={alert.id} className={`flex items-start gap-2.5 p-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                {cfg.icon}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-semibold truncate">{alert.title}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${cfg.labelClass}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{alert.exam}</p>
                  <p className={`text-[11px] font-medium mt-1 ${cfg.timeClass}`}>
                    {alert.urgency === "overdue"
                      ? `Overdue by ${formatDistanceToNow(new Date(alert.deadline))}`
                      : `Due ${formatDistanceToNow(new Date(alert.deadline), { addSuffix: true })}`}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CheckSquare size={11} /> {alert.currentQuestions}/{alert.weeklyTargetQuestions} uploaded
                    </span>
                    <span>{alert.remainingQuestions} left</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Deadline: {format(new Date(alert.deadline), "MMM d, yyyy · h:mm a")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1 h-9 text-xs" onClick={onDismiss}>
            Dismiss
          </Button>
          <Link href={href} onClick={onDismiss}>
            <Button className="flex-1 h-9 text-xs gap-1">
              Open Question Bank <ArrowRight size={13} />
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
