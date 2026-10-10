import { Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STUDENT_VERIFICATION_CONTACT_EMAIL } from "@/lib/student-access";

type PendingVerificationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckStatus?: () => void;
  title?: string;
  description?: string;
  emailSubject?: string;
  emailBody?: string;
  checkStatusLabel?: string;
};

export default function PendingVerificationDialog({
  open,
  onOpenChange,
  onCheckStatus,
  title = "Verification Pending",
  description = "The dashboard preview is available, but this feature will unlock only after admin verification.",
  emailSubject = "Student verification pending",
  emailBody = "Hi Admin,\n\nMy account verification is still pending. Please review my student account.\n",
  checkStatusLabel = "Check status",
}: PendingVerificationDialogProps) {
  const handleEmailAdmin = () => {
    if (typeof window === "undefined") return;
    const subject = encodeURIComponent(emailSubject);
    const body = encodeURIComponent(emailBody);
    window.location.href = `mailto:${STUDENT_VERIFICATION_CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[28px] border border-[#E5E7EB] bg-white p-0">
        <div className="overflow-hidden rounded-[28px]">
          <div className="bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFC_100%)] px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F97316] text-white shadow-sm">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-xl font-bold text-[#111827]">{title}</DialogTitle>
                <DialogDescription className="text-sm leading-6 text-[#6B7280]">
                  {description}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FAFBFF] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9AA4B2]">Contact Admin</p>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#111827]">
                <Mail className="h-4 w-4 text-[#F97316]" />
                <span>{STUDENT_VERIFICATION_CONTACT_EMAIL}</span>
              </div>
            </div>

            <p className="text-sm leading-6 text-[#6B7280]">
              Once your verification is approved, tests, question bank access, and the remaining student actions will become active automatically.
            </p>

            <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-[#E5E7EB]"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {onCheckStatus ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl border-[#FED7AA] text-[#F97316] hover:bg-[#FFF7ED]"
                    onClick={() => {
                      onOpenChange(false);
                      onCheckStatus();
                    }}
                  >
                    {checkStatusLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                  onClick={handleEmailAdmin}
                >
                  Email admin
                </Button>
              </div>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
