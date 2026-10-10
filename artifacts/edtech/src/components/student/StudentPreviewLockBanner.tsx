import { LockKeyhole, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STUDENT_VERIFICATION_CONTACT_EMAIL } from "@/lib/student-access";

type StudentPreviewLockBannerProps = {
  title: string;
  description: string;
  onCheckStatus: () => void;
  onOpenLocked: () => void;
  eyebrow?: string;
};

export default function StudentPreviewLockBanner({
  title,
  description,
  onCheckStatus,
  onOpenLocked,
  eyebrow = "Verification Pending",
}: StudentPreviewLockBannerProps) {
  return (
    <div className="mx-auto w-full overflow-hidden rounded-[28px] border border-[#FED7AA] bg-[linear-gradient(135deg,#FFF7ED_0%,#FFEDD5_100%)] shadow-[0_12px_32px_rgba(249,115,22,0.08)]">
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex max-w-[980px] items-center gap-4">
          <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[20px] bg-[#DC3D2F] text-white shadow-[0_10px_22px_rgba(220,61,47,0.28)]">
            <ShieldAlert className="h-5.5 w-5.5 translate-y-[0.5px]" />
          </div>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#DC3D2F]">{eyebrow}</p>
            <h2 className="mt-0.5 text-[20px] font-black leading-tight tracking-tight text-[#111827] sm:text-[22px]">
              {title}
            </h2>
            <p className="mt-1.5 max-w-[820px] text-sm leading-6 text-[#6B7280]">
              {description}
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <Mail className="h-4 w-4 shrink-0 text-[#F97316]" />
              <span className="break-all sm:break-normal">{STUDENT_VERIFICATION_CONTACT_EMAIL}</span>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-nowrap items-center gap-3 overflow-x-auto pb-1 lg:w-auto lg:justify-end lg:overflow-visible lg:pb-0">
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 whitespace-nowrap rounded-[20px] border-[#FED7AA] bg-white px-5 text-sm font-semibold text-[#F97316] shadow-[0_8px_24px_rgba(249,115,22,0.06)] hover:bg-[#FFF7ED]"
            onClick={onCheckStatus}
          >
            Check status
          </Button>
          <Button
            type="button"
            className="h-10 shrink-0 whitespace-nowrap rounded-[20px] bg-[#DE8E33] px-5 text-sm font-semibold text-white shadow-[0_16px_28px_rgba(222,142,51,0.28)] hover:bg-[#CF7F22]"
            onClick={onOpenLocked}
          >
            <span className="inline-flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              <span>Unlock</span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
