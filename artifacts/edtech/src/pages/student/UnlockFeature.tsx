import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import StudentFeatureUnlockView from "@/components/student/StudentFeatureUnlockView";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getStudentFeatureUnlockAmount, isStudentFeatureLocked } from "@/lib/student-access";
import { type StudentUnlockFeature } from "@/lib/student-unlock";
import type { AuthUser } from "@/types/auth";
import { buildApiUrl } from "@/lib/api-origin";

type RazorpayOrderResponse = {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  amount: number;
  feature: StudentUnlockFeature;
};

type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  method?: {
    upi?: boolean;
    card?: boolean;
    netbanking?: boolean;
    wallet?: boolean;
    emi?: boolean;
    paylater?: boolean;
  };
  config?: {
    display?: {
      blocks?: Record<string, {
        name: string;
        instruments: Array<{ method: string }>;
      }>;
      sequence?: string[];
      preferences?: { show_default_blocks?: boolean };
    };
  };
  modal?: {
    ondismiss?: () => void;
  };
  handler?: (response: RazorpayHandlerResponse) => void;
};

type RazorpayInstance = {
  open: () => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

let razorpayScriptPromise: Promise<boolean> | null = null;

function readSearchParam(name: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? "";
}

function sanitizeBackPath(value: string) {
  if (!value || !value.startsWith("/")) return "";
  if (value.startsWith("//")) return "";
  return value;
}

function sanitizeReturnPath(value: string) {
  if (!value || !value.startsWith("/")) return "";
  if (value.startsWith("//")) return "";
  return value;
}

function getDefaultReturnPath(feature: StudentUnlockFeature) {
  if (feature === "tests") return "/student/tests";
  if (feature === "question-bank") return "/student/question-bank";
  if (feature === "analysis") return "/student/tests";
  if (feature === "pyq") return "/student/pyq";
  return "/student/tests";
}

async function loadRazorpayCheckoutScript() {
  if (typeof window === "undefined") return false;
  if (window.Razorpay) return true;
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

async function fetchUpdatedCurrentUser() {
  const response = await fetch(buildApiUrl(`/api/auth/me`), { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Could not refresh your account");
  }
  return response.json() as Promise<AuthUser>;
}

export default function StudentUnlockFeaturePage() {
  const { feature } = useParams<{ feature: StudentUnlockFeature }>();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const safeFeature: StudentUnlockFeature = feature === "question-bank" ? "question-bank" : feature === "analysis" ? "analysis" : feature === "pyq" ? "pyq" : "tests";
  const amount = getStudentFeatureUnlockAmount(user, safeFeature);
  const isLocked = isStudentFeatureLocked(user, safeFeature);

  const metadata = useMemo(
    () => ({
      kind: readSearchParam("kind"),
      label: readSearchParam("label"),
      examLabel: readSearchParam("exam"),
      subjectLabel: readSearchParam("subject"),
      returnTo: sanitizeReturnPath(readSearchParam("returnTo")),
      backTo: sanitizeBackPath(readSearchParam("backTo")),
    }),
    [feature, location],
  );

  const fallbackPath = metadata.returnTo || getDefaultReturnPath(safeFeature);
  const backPath = metadata.backTo || fallbackPath;

  useEffect(() => {
    if (!isLocked) {
      setLocation(fallbackPath);
    }
  }, [fallbackPath, isLocked, setLocation]);

  const handlePayment = async () => {
    setPaymentError(null);
    setIsPaying(true);

    try {
      const orderResponse = await fetch(buildApiUrl(`/api/users/me/student-feature-unlock/order`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: safeFeature }),
      });
      const orderPayload = await orderResponse.json().catch(() => null) as RazorpayOrderResponse & { error?: string };
      if (!orderResponse.ok) {
        throw new Error(orderPayload?.error || "Could not start the payment");
      }

      const checkoutReady = await loadRazorpayCheckoutScript();
      if (!checkoutReady || !window.Razorpay) {
        throw new Error("Razorpay checkout could not be loaded on this device.");
      }

      const razorpay = new window.Razorpay({
        key: orderPayload.keyId,
        amount: orderPayload.amountPaise,
        currency: orderPayload.currency,
        name: "RankPulse",
        description: safeFeature === "tests" ? "Tests unlock" : safeFeature === "analysis" ? "Full Analysis unlock" : safeFeature === "pyq" ? "PYQ unlock" : "Question bank unlock",
        order_id: orderPayload.orderId,
        prefill: {
          name: user?.fullName ?? user?.username ?? "",
          email: user?.email ?? "",
          contact: user?.phone ?? "",
        },
        method: {
          upi: true,
          card: false,
          netbanking: false,
          wallet: false,
          emi: false,
          paylater: false,
        },
        config: {
          display: {
            blocks: {
              upi: {
                name: "Pay via UPI",
                instruments: [{ method: "upi" }],
              },
            },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: false },
          },
        },
        theme: { color: "#D97706" },
        modal: {
          ondismiss: () => {
            setIsPaying(false);
          },
        },
        handler: async (response) => {
          try {
            const verifyResponse = await fetch(buildApiUrl(`/api/users/me/student-feature-unlock/verify`), {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                feature: safeFeature,
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });
            const verifyPayload = await verifyResponse.json().catch(() => null) as { error?: string; message?: string; user?: AuthUser };
            if (!verifyResponse.ok) {
              throw new Error(verifyPayload?.error || "Payment verification failed");
            }

            const nextUser = verifyPayload?.user ?? await fetchUpdatedCurrentUser();
            login(nextUser);
            queryClient.setQueryData(["auth", "me"], nextUser);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["student-tests"] }),
              queryClient.invalidateQueries({ queryKey: ["student-question-bank-exams"] }),
              queryClient.invalidateQueries({ queryKey: ["dashboard-question-bank-progress"] }),
              queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "student"] }),
              queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "student"] }),
              queryClient.invalidateQueries({ queryKey: ["pyq-questions", "student"] }),
              queryClient.invalidateQueries({ queryKey: ["pyq-progress-summary", "student"] }),
            ]);

            toast({
              title: "Unlock complete",
              description: verifyPayload?.message || "Payment was successful and the feature is now unlocked.",
            });
            setLocation(fallbackPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Payment verification failed";
            setPaymentError(message);
            toast({
              title: "Payment verification failed",
              description: message,
              variant: "destructive",
            });
          } finally {
            setIsPaying(false);
          }
        },
      });

      razorpay.open();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the payment";
      setPaymentError(message);
      toast({
        title: "Could not start payment",
        description: message,
        variant: "destructive",
      });
      setIsPaying(false);
    }
  };

  return (
    <StudentFeatureUnlockView
      feature={safeFeature}
      kind={metadata.kind === "chapter" || metadata.kind === "test" ? metadata.kind : "feature"}
      label={metadata.label}
      examLabel={metadata.examLabel}
      subjectLabel={metadata.subjectLabel}
      amount={amount}
      onBack={() => setLocation(backPath)}
      onPay={handlePayment}
      isPaying={isPaying}
      paymentError={paymentError}
      paymentReady
    />
  );
}
