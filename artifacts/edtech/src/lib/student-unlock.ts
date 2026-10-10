export type StudentUnlockFeature = "tests" | "question-bank" | "analysis" | "pyq";
export type StudentUnlockKind = "feature" | "test" | "chapter";

type BuildStudentUnlockPathOptions = {
  feature: StudentUnlockFeature;
  kind?: StudentUnlockKind;
  label?: string | null;
  examLabel?: string | null;
  subjectLabel?: string | null;
  returnTo?: string | null;
  backTo?: string | null;
};

export function getStudentUnlockFeatureLabel(feature: StudentUnlockFeature) {
  if (feature === "tests") return "Tests";
  if (feature === "analysis") return "Test Analysis";
  if (feature === "pyq") return "PYQ";
  return "Question Bank";
}

export function buildStudentUnlockPath({
  feature,
  kind = "feature",
  label,
  examLabel,
  subjectLabel,
  returnTo,
  backTo,
}: BuildStudentUnlockPathOptions) {
  const search = new URLSearchParams();
  search.set("kind", kind);
  if (label?.trim()) search.set("label", label.trim());
  if (examLabel?.trim()) search.set("exam", examLabel.trim());
  if (subjectLabel?.trim()) search.set("subject", subjectLabel.trim());
  if (returnTo?.trim().startsWith("/")) search.set("returnTo", returnTo.trim());
  if (backTo?.trim().startsWith("/")) search.set("backTo", backTo.trim());

  const query = search.toString();
  return `/student/unlock/${feature}${query ? `?${query}` : ""}`;
}
