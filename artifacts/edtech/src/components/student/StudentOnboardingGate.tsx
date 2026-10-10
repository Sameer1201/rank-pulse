import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import indiaStateDistrictSource from "@/data/india-state-districts.json";
import { formatExamDisplayName } from "@/lib/exam-display";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import { invalidateStudentContentQueries } from "@/lib/student-content-cache";
import type { AuthUser, StudentProfileDetails } from "@/types/auth";
import { buildApiUrl } from "@/lib/api-origin";

const ONBOARDING_DRAFT_STORAGE_KEY = "student-onboarding-draft";
const ONBOARDING_RETURN_TO_KEY = "student-onboarding-return-to";

interface RegistrationExamOption {
  exam: string;
  label: string;
}

const steps = [
  { title: "Personal Details", subtitle: "Basic account details" },
] as const;

const preparationModes = [
  "Online Paid Course",
  "Offline Paid Course",
  "Combination of Online & Offline Paid Courses",
  "Self Study using Free Resources",
] as const;

const providerOptions = [
  "Physics Wallah (PW)",
  "Unacademy",
  "Competishun",
  "IIT School",
  "eSaral",
  "Vedantu",
  "Aakash Byju's",
  "Other",
] as const;

const classLevelOptions = [
  "Clg 1st",
  "Clg 2nd",
  "Clg 3rd",
  "Clg 4th",
  "Graduated",
] as const;

const COLLEGE_BOARD_VALUE = "UG University";

const hearAboutOptions = [
  "YouTube",
  "Instagram",
  "Telegram",
  "Friend or Family",
  "School or Coaching",
  "Google Search",
  "Other",
] as const;

const indiaStateOptions = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

type IndiaStateDistrictSource = {
  states: Array<{
    state: string;
    districts: string[];
  }>;
};

function normalizeLocationName(value: string) {
  return value.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function buildDistrictOptionsByState() {
  const source = indiaStateDistrictSource as IndiaStateDistrictSource;
  const stateAliases: Record<string, string> = {
    "Chandigarh (UT)": "Chandigarh",
    "Dadra and Nagar Haveli (UT)": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman and Diu (UT)": "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi (NCT)": "Delhi",
    "Lakshadweep (UT)": "Lakshadweep",
    "Puducherry (UT)": "Puducherry",
  };

  const districtsByState = new Map<string, string[]>(
    indiaStateOptions.map((state) => [state, []]),
  );

  const appendDistrict = (state: string, district: string) => {
    const normalizedDistrict = normalizeLocationName(district);
    if (!normalizedDistrict) return;
    const existing = districtsByState.get(state) ?? [];
    if (!existing.includes(normalizedDistrict)) {
      existing.push(normalizedDistrict);
      districtsByState.set(state, existing);
    }
  };

  source.states.forEach((entry) => {
    const targetState = stateAliases[entry.state] ?? entry.state;
    if (!districtsByState.has(targetState)) return;
    entry.districts.forEach((district) => appendDistrict(targetState, district));
  });

  ["Nicobar", "North and Middle Andaman", "South Andaman"].forEach((district) => appendDistrict("Andaman and Nicobar Islands", district));
  ["Kargil", "Leh"].forEach((district) => appendDistrict("Ladakh", district));

  const jammuAndKashmirDistricts = districtsByState.get("Jammu and Kashmir") ?? [];
  districtsByState.set(
    "Jammu and Kashmir",
    jammuAndKashmirDistricts.filter((district) => district !== "Kargil" && district !== "Leh"),
  );

  return Object.fromEntries(districtsByState.entries());
}

const districtOptionsByState = buildDistrictOptionsByState();

function normalizeCollegeStage(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  const legacyStageMap: Record<string, typeof classLevelOptions[number]> = {
    "College 1st Year": "Clg 1st",
    "College 2nd Year": "Clg 2nd",
    "College 3rd Year": "Clg 3rd",
    "College 4th Year": "Clg 4th",
    Graduate: "Graduated",
  };
  const mapped = legacyStageMap[normalized] ?? normalized;
  return classLevelOptions.includes(mapped as typeof classLevelOptions[number]) ? mapped : "";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function buildInitialDetails(user: AuthUser): StudentProfileDetails {
  const existing = user.profileDetails;
  const existingInstitutionName = existing?.preparation?.institutionName ?? "";
  const existingCollegeName = existing?.preparation?.collegeName ?? "";
  const collegeName = existingCollegeName || existingInstitutionName;
  return {
    dateOfBirth: existing?.dateOfBirth ?? "",
    whatsappOnSameNumber: existing?.whatsappOnSameNumber ?? true,
    whatsappNumber: existing?.whatsappNumber ?? user.phone ?? "",
    address: {
      country: "India",
      state: existing?.address?.state ?? "",
      district: existing?.address?.district ?? "",
      street: existing?.address?.street ?? "",
      city: existing?.address?.city ?? "",
      pincode: existing?.address?.pincode ?? "",
    },
    preparation: {
      classLevel: normalizeCollegeStage(existing?.preparation?.classLevel),
      board: COLLEGE_BOARD_VALUE,
      targetYear: existing?.preparation?.targetYear ?? "",
      targetExam: existing?.preparation?.targetExam ?? user.subject ?? "",
      institutionName: collegeName,
      collegeName,
      universityName: existing?.preparation?.universityName ?? "",
    },
    learningMode: {
      mode: existing?.learningMode?.mode ?? "",
      provider: existing?.learningMode?.provider ?? "",
    },
    hearAboutUs: existing?.hearAboutUs ?? "",
  };
}

function mergeStudentProfileDetails(base: StudentProfileDetails, incoming: Partial<StudentProfileDetails> | null | undefined) {
  if (!incoming) return base;
  const mergedPreparation = {
    ...base.preparation,
    ...(incoming.preparation ?? {}),
  };
  const collegeName = (mergedPreparation.collegeName || mergedPreparation.institutionName || "").trim();

  return {
    ...base,
    ...incoming,
    address: {
      ...base.address,
      ...(incoming.address ?? {}),
    },
    preparation: {
      ...mergedPreparation,
      classLevel: normalizeCollegeStage(mergedPreparation.classLevel),
      board: COLLEGE_BOARD_VALUE,
      institutionName: collegeName,
      collegeName,
      universityName: mergedPreparation.universityName ?? "",
    },
    learningMode: {
      ...base.learningMode,
      ...(incoming.learningMode ?? {}),
    },
    dashboard: {
      ...(base.dashboard ?? {}),
      ...(incoming.dashboard ?? {}),
    },
  };
}

export default function StudentOnboardingGate() {
  const { user, login } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const authUser = user as AuthUser | null;
  const rejectedResubmission = authUser?.role === "student" && authUser.status === "rejected";
  const gateEnabled = !!authUser && authUser.role === "student" && (!authUser.onboardingComplete || rejectedResubmission);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(authUser?.fullName ?? "");
  const [phone, setPhone] = useState(authUser?.phone ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>((authUser as any)?.avatarUrl ?? null);
  const [avatarImageFailed, setAvatarImageFailed] = useState(false);
  const [details, setDetails] = useState<StudentProfileDetails | null>(authUser ? buildInitialDetails(authUser) : null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const draftStorageKey = authUser ? `${ONBOARDING_DRAFT_STORAGE_KEY}:${authUser.id}` : null;
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const { data: examOptions = [] } = useQuery<RegistrationExamOption[]>({
    queryKey: ["registration-exams"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/auth/exams`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load exams");
      return response.json();
    },
    enabled: gateEnabled,
    staleTime: 60000,
    retry: 1,
  });

  useEffect(() => {
    if (!authUser || authUser.role !== "student") return;
    setFullName(authUser.fullName ?? "");
    setPhone(authUser.phone ?? "");
    setAvatarPreview((authUser as any)?.avatarUrl ?? null);
    setAvatarImageFailed(false);
    setDetails(buildInitialDetails(authUser));
    setStep(Math.min(Math.max(0, authUser.onboardingDraftStep ?? 0), steps.length - 1));
    setError("");
  }, [authUser?.id, authUser?.fullName, authUser?.phone, authUser?.role, authUser?.onboardingComplete, authUser?.onboardingDraftStep, authUser?.status, (authUser as any)?.avatarUrl]);

  useEffect(() => {
    if (!draftStorageKey || !authUser || authUser.role !== "student" || authUser.onboardingComplete) return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        step?: number;
        fullName?: string;
        phone?: string;
        avatarPreview?: string | null;
        details?: StudentProfileDetails;
      };
      if (typeof draft.fullName === "string") setFullName(draft.fullName);
      if (typeof draft.phone === "string") setPhone(draft.phone);
      if (typeof draft.avatarPreview === "string" || draft.avatarPreview === null) {
        setAvatarPreview(draft.avatarPreview ?? null);
        setAvatarImageFailed(false);
      }
      if (draft.details && typeof draft.details === "object") {
        const draftDetails = draft.details;
        setDetails((prev) => mergeStudentProfileDetails(prev ?? buildInitialDetails(authUser), draftDetails));
      }
      if (typeof draft.step === "number" && Number.isFinite(draft.step)) {
        setStep(Math.min(Math.max(0, draft.step), steps.length - 1));
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [authUser?.id, authUser?.role, authUser?.onboardingComplete, draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !authUser || authUser.role !== "student" || authUser.onboardingComplete || !details) return;
    const draft = {
      step,
      fullName,
      phone,
      avatarPreview,
      details,
    };
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [authUser, avatarPreview, details, draftStorageKey, fullName, phone, step]);

  useEffect(() => {
    setAvatarImageFailed(false);
  }, [avatarPreview]);

  useEffect(() => {
    const shouldLockBody = gateEnabled && (!rejectedResubmission || location === "/student/profile");
    if (!shouldLockBody) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [gateEnabled, rejectedResubmission, location]);

  useEffect(() => {
    if (!details?.whatsappOnSameNumber) return;
    setDetails((prev) => (
      prev
        ? {
            ...prev,
            whatsappNumber: phone,
          }
        : prev
    ));
  }, [details?.whatsappOnSameNumber, phone]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, index) => String(currentYear + index));
  }, []);

  const selectedState = details?.address.state ?? "";
  const selectedDistrict = details?.address.district ?? "";

  const districtOptions: string[] = !selectedState
    ? []
    : (() => {
        const options = districtOptionsByState[selectedState] ?? [];
        const currentDistrict = normalizeLocationName(selectedDistrict);
        return currentDistrict && !options.includes(currentDistrict) ? [...options, currentDistrict] : options;
      })();
  const usesCustomHearAboutSource = !!details?.hearAboutUs?.trim() && !hearAboutOptions.includes(details.hearAboutUs as typeof hearAboutOptions[number]);
  const selectedHearAboutSource = usesCustomHearAboutSource ? "Other" : details?.hearAboutUs ?? "";
  const hearAboutOtherValue = usesCustomHearAboutSource ? (details?.hearAboutUs ?? "") : "";

  const handleStateChange = (state: string) => {
    const nextDistrictOptions = districtOptionsByState[state] ?? [];
    setDetails((prev) =>
      prev
        ? {
            ...prev,
            address: {
              ...prev.address,
              state,
              district: nextDistrictOptions.includes(prev.address.district) ? prev.address.district : "",
            },
          }
        : prev,
    );
  };

  if (!authUser || authUser.role !== "student" || !details) {
    return null;
  }

  if (!gateEnabled) {
    return null;
  }

  if (rejectedResubmission && location !== "/student/profile") {
    return null;
  }

  const updateDetails = <K extends keyof StudentProfileDetails>(key: K, value: StudentProfileDetails[K]) => {
    setDetails((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateNestedDetails = <
    K extends keyof StudentProfileDetails,
    NK extends keyof StudentProfileDetails[K] & string,
  >(key: K, nestedKey: NK, value: StudentProfileDetails[K][NK]) => {
    setDetails((prev) =>
      prev
        ? {
            ...prev,
            [key]: {
              ...(prev[key] as Record<string, unknown>),
              [nestedKey]: value,
            },
          }
        : prev,
    );
  };

  const handleAvatarSelect = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB.");
      return;
    }
    try {
      const resized = await optimizeImageToDataUrl(file, {
        maxWidth: 256,
        maxHeight: 256,
        quality: 0.85,
        outputType: "image/jpeg",
      });
      setAvatarPreview(resized);
      setAvatarImageFailed(false);
      setError("");
    } catch {
      setError("Failed to process the selected image.");
    }
  };

  const saveDraftProgress = async (nextStep: number) => {
    const response = await fetch(buildApiUrl(`/api/auth/student-onboarding/draft`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: fullName.trim(),
        phone: phone.trim(),
        avatarUrl: avatarPreview,
        step: nextStep,
        profileDetails: {
          ...details,
          preparation: {
            ...details.preparation,
            board: COLLEGE_BOARD_VALUE,
            institutionName: details.preparation.collegeName.trim() || details.preparation.institutionName.trim(),
          },
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to save setup progress");
    }

    login(payload as AuthUser);
  };

  const validateStep = () => {
    if (step === 0) {
      if (!avatarPreview?.trim()) return "Add a profile photo before continuing.";
      if (!fullName.trim()) return "Full name is required.";
      if (!phone.trim()) return "Phone number is required.";
      if (!details.preparation.collegeName.trim() && !details.preparation.institutionName.trim()) return "College name is required.";
      if (!details.preparation.targetExam.trim()) return "Target exam is required.";
    }
    return "";
  };

  const handleNext = async () => {
    const nextError = validateStep();
    if (nextError) {
      setError(nextError);
      return;
    }
    setError("");

    setSaving(true);
    try {
      const collegeName = details.preparation.collegeName.trim() || details.preparation.institutionName.trim();
      const response = await fetch(buildApiUrl(`/api/auth/student-onboarding`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          avatarUrl: avatarPreview,
          subject: details.preparation.targetExam.trim(),
          profileDetails: {
            ...details,
            preparation: {
              ...details.preparation,
              board: COLLEGE_BOARD_VALUE,
              institutionName: collegeName,
              collegeName,
            },
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save setup");
      }
      if (draftStorageKey) {
        window.localStorage.removeItem(draftStorageKey);
      }
      login(payload as AuthUser);
      await invalidateStudentContentQueries(queryClient);
      let returnTo = "";
      try {
        returnTo = window.localStorage.getItem(ONBOARDING_RETURN_TO_KEY) ?? "";
        window.localStorage.removeItem(ONBOARDING_RETURN_TO_KEY);
      } catch {}
      setLocation(returnTo.startsWith("/") ? returnTo : "/student/pending-approval");
    } catch (err: any) {
      setError(err.message ?? "Failed to save setup");
    } finally {
      setSaving(false);
    }
  };

  const indicator = (index: number) => {
    if (index < step) return "done";
    if (index === step) return "current";
    return "upcoming";
  };

  const targetExamField = examOptions.length > 0 ? (
    <select
      value={details.preparation.targetExam}
      onChange={(event) => updateNestedDetails("preparation", "targetExam", event.target.value)}
      className="h-12 w-full rounded-2xl border border-[#DCE3F1] bg-white px-4 text-sm text-[#111827] outline-none transition focus:border-[#F97316]"
    >
      <option value="">Select your target exam</option>
      {examOptions.map((option) => (
        <option key={option.exam} value={option.exam}>
          {formatExamDisplayName(option.label || option.exam) || option.label}
        </option>
      ))}
    </select>
  ) : (
    <Input
      value={details.preparation.targetExam}
      onChange={(event) => updateNestedDetails("preparation", "targetExam", event.target.value)}
      placeholder="Enter your target exam"
      className="h-12 rounded-2xl border-[#DCE3F1]"
    />
  );

  const avatarInitials = getInitials(fullName.trim() || authUser.fullName || authUser.username || "S");

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[#111827]/20 px-3 py-3 backdrop-blur-[3px] sm:items-center sm:px-4 sm:py-6">
      <div className="flex max-h-[calc(100dvh-0.75rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_30px_80px_rgba(17,24,39,0.18)] sm:max-h-[92vh] sm:rounded-[28px]">
        <div className="border-b border-[#EEF2F7] px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#F97316]">Complete Setup</p>
              <h2 className="mt-1 text-xl font-bold text-[#111827] sm:text-2xl">
                {rejectedResubmission ? "Update and resubmit your profile" : "Finish your student profile"}
              </h2>
              {rejectedResubmission && authUser.rejectionReason ? (
                <div className="mt-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#7F1D1D]">
                  <span className="font-semibold text-[#B91C1C]">Rejection reason:</span> {authUser.rejectionReason}
                </div>
              ) : null}
            </div>
            <div className="rounded-full bg-[#FFF7ED] px-3 py-1 text-xs font-semibold text-[#F97316]">
              Step {step + 1} of {steps.length}
            </div>
          </div>

          <div className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
            {steps.map((entry, index) => {
              const state = indicator(index);
              return (
                <div key={entry.title} className="min-w-[104px] flex-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                        state === "done"
                          ? "border-[#F97316] bg-[#F97316] text-white"
                          : state === "current"
                            ? "border-[#F97316] bg-white text-[#F97316]"
                            : "border-[#DCE3F1] bg-white text-[#9AA4B2]"
                      }`}
                    >
                      {state === "done" ? <Check size={14} /> : index + 1}
                    </div>
                    {index < steps.length - 1 && (
                      <div className={`h-px flex-1 ${index < step ? "bg-[#F97316]" : "bg-[#DCE3F1]"}`} />
                    )}
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-tight text-[#111827]">{entry.title}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error ? (
            <div className="mb-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
              {error}
            </div>
          ) : null}

          {step === 0 ? (
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-bold tracking-tight text-[#111827] sm:text-3xl">Personal details</p>
                <p className="mt-2 text-sm text-[#6B7280]">We need a few details before we personalize your student experience.</p>
              </div>
              <div className="rounded-[24px] border border-[#E5EAF4] bg-[#F8FAFF] p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[24px] border border-[#DCE3F1] bg-white shadow-[0_12px_24px_rgba(17,24,39,0.08)]">
                      {avatarPreview && !avatarImageFailed ? (
                        <img
                          src={avatarPreview}
                          alt="Profile photo"
                          className="h-full w-full object-cover"
                          decoding="async"
                          onError={() => setAvatarImageFailed(true)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FF9B3D] to-[#FF7A18] text-2xl font-semibold text-white">
                          {avatarInitials || "S"}
                        </div>
                      )}
                      <div className="absolute bottom-1.5 right-1.5 rounded-full bg-[#111827] p-1.5 text-white shadow-lg">
                        <Camera size={12} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#111827]">Add profile photo</p>
                      <p className="max-w-md text-sm leading-6 text-[#6B7280]">
                        Choose a profile photo for your account. You can update it anytime later.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => avatarInputRef.current?.click()}
                    className="rounded-2xl border-[#D6DEF0] bg-white px-5"
                  >
                    {avatarPreview ? "Change Photo" : "Upload Photo"}
                  </Button>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      void handleAvatarSelect(file);
                    }
                  }}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="onboarding-full-name" className="mb-2 block text-sm font-medium text-[#374151]">Full name</Label>
                  <Input
                    id="onboarding-full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Enter your full name"
                    className="h-12 rounded-2xl border-[#DCE3F1]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="onboarding-email" className="mb-2 block text-sm font-medium text-[#374151]">Email ID</Label>
                  <Input
                    id="onboarding-email"
                    type="email"
                    value={authUser.email ?? ""}
                    disabled
                    className="h-12 rounded-2xl border-[#DCE3F1] bg-[#F8FAFC] text-[#111827] disabled:opacity-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="onboarding-phone" className="mb-2 block text-sm font-medium text-[#374151]">Phone number</Label>
                  <Input
                    id="onboarding-phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Enter your phone number"
                    className="h-12 rounded-2xl border-[#DCE3F1]"
                  />
                </div>
                <div>
                  <Label htmlFor="onboarding-college" className="mb-2 block text-sm font-medium text-[#374151]">Full college name</Label>
                  <Input
                    id="onboarding-college"
                    value={details.preparation.collegeName}
                    onChange={(event) => {
                      const nextCollegeName = event.target.value;
                      setDetails((prev) => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          preparation: {
                            ...prev.preparation,
                            board: COLLEGE_BOARD_VALUE,
                            institutionName: nextCollegeName,
                            collegeName: nextCollegeName,
                          },
                        };
                      });
                    }}
                    placeholder="Enter your full official college name"
                    className="h-12 rounded-2xl border-[#DCE3F1]"
                  />
                  <p className="mt-1.5 text-xs leading-5 text-[#6B7280]">Use the complete name as it appears on your college records.</p>
                </div>
                <div>
                  <Label htmlFor="onboarding-target-exam" className="mb-2 block text-sm font-medium text-[#374151]">Target exam</Label>
                  {targetExamField}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-[#EEF2F7] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError("");
              setStep((current) => Math.max(0, current - 1));
            }}
            disabled={step === 0 || saving}
            className="w-full rounded-2xl sm:w-auto sm:min-w-[120px]"
          >
            Previous
          </Button>
          <Button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="w-full rounded-2xl bg-[#F97316] hover:bg-[#EA580C] sm:w-auto sm:min-w-[180px]"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Saving...
              </>
            ) : step === steps.length - 1 ? "Complete Setup" : "Save & Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
