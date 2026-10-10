type SubjectSectionIconProps = {
  label: string;
  className?: string;
};

import { SubjectThemeIcon } from "@/lib/subject-theme";

export function SubjectSectionIcon({ label, className = "h-4 w-4" }: SubjectSectionIconProps) {
  return <SubjectThemeIcon label={label} className={className} />;
}
