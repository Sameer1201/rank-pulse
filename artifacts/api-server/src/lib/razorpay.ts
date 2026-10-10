import { createHmac } from "node:crypto";

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  notes?: Record<string, string>;
  status?: string;
};

type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
};

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getRazorpayKeyId() {
  return readTrimmedEnv("RAZORPAY_KEY_ID");
}

function getRazorpayKeySecret() {
  return readTrimmedEnv("RAZORPAY_KEY_SECRET");
}

export function isRazorpayConfigured() {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret());
}

function getRazorpayAuthHeader() {
  const keyId = getRazorpayKeyId();
  const keySecret = getRazorpayKeySecret();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured on the server yet");
  }
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function razorpayRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: getRazorpayAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({})) as {
    error?: { description?: string; reason?: string; code?: string };
  } & T;

  if (!response.ok) {
    throw new Error(
      payload.error?.description
      || payload.error?.reason
      || payload.error?.code
      || "Razorpay request failed",
    );
  }

  return payload;
}

export async function createRazorpayOrder(options: {
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}) {
  return razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: options.amountPaise,
      currency: options.currency ?? "INR",
      receipt: options.receipt,
      notes: options.notes ?? {},
    }),
  });
}

export async function getRazorpayPayment(paymentId: string) {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function captureRazorpayPayment(options: {
  paymentId: string;
  amountPaise: number;
  currency?: string;
}) {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(options.paymentId)}/capture`, {
    method: "POST",
    body: JSON.stringify({
      amount: options.amountPaise,
      currency: options.currency ?? "INR",
    }),
  });
}

export function verifyRazorpayPaymentSignature(options: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  const secret = getRazorpayKeySecret();
  if (!secret) {
    throw new Error("Razorpay is not configured on the server yet");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${options.orderId}|${options.paymentId}`)
    .digest("hex");

  return expectedSignature === options.signature;
}
