import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { buildApiUrl } from "@/lib/api-origin";

// Generate a stable session token per browser tab
function getSessionToken(): string {
  let token = sessionStorage.getItem("edtech_session_token");
  if (!token) {
    token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("edtech_session_token", token);
  }
  return token;
}

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/admin/students": "Admin Students",
  "/admin/question-bank": "Admin Question Bank",
  "/admin/tests": "Admin Tests",
  "/student/dashboard": "Student Dashboard",
  "/student/tests": "Student Tests",
  "/super-admin/dashboard": "Super Admin Dashboard",
  "/super-admin/management": "Management",
  "/super-admin/admins": "Management",
  "/super-admin/students": "Management",
  "/super-admin/tests": "Tests Overview",
  "/super-admin/activity": "User Activity",
  "/super-admin/question-bank": "Super Admin Question Bank",
  "/super-admin/exam-templates": "Super Admin Exam Templates",
};

function getPageLabel(path: string): string {
  // Check exact match first
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  // Dynamic routes
  return path;
}

export function useActivityTracker(isAuthenticated: boolean) {
  const [location] = useLocation();
  const sessionToken = useRef(getSessionToken());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPageRef = useRef<string>("");

  const logActivity = useCallback(async (action: string, page?: string, detail?: string) => {
    try {
      await fetch(buildApiUrl("/api/activity/log"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, page, detail }),
      });
    } catch { /* silent — don't block UI */ }
  }, []);

  const sendHeartbeat = useCallback(async () => {
    // A background tab is not a reliable signal that the user is currently online.
    if (document.visibilityState !== "visible") return;
    try {
      await fetch(buildApiUrl("/api/activity/heartbeat"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: sessionToken.current }),
      });
    } catch { /* silent */ }
  }, []);

  // Start session when user is authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    const startSession = async () => {
      try {
        await fetch(buildApiUrl("/api/activity/session/start"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: sessionToken.current }),
        });
        await logActivity("login", location, "Session started");
      } catch { /* silent */ }
    };

    startSession();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void sendHeartbeat();
    };

    // Heartbeat only while this tab is visible; the server expires presence quickly
    // after the tab is hidden or the browser closes unexpectedly.
    heartbeatRef.current = setInterval(sendHeartbeat, 120_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // End session on tab close
    const handleUnload = () => {
      navigator.sendBeacon(buildApiUrl("/api/activity/session/end"),
        JSON.stringify({ sessionToken: sessionToken.current }));
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleUnload);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Log page views on route change
  useEffect(() => {
    if (!isAuthenticated) return;
    if (location === lastPageRef.current) return;
    lastPageRef.current = location;
    logActivity("page_view", location, getPageLabel(location));
  }, [location, isAuthenticated, logActivity]);
}

// Exported helper to log specific actions from any component
export async function logAction(action: string, page?: string, detail?: string) {
  try {
    await fetch(buildApiUrl("/api/activity/log"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, page, detail }),
    });
  } catch { /* silent */ }
}
