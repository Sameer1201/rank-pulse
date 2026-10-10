const LOCAL_PUBLIC_APP_URL = "http://localhost:5173";
const LEGACY_PUBLIC_APP_URL = "https://educonnect-platform-production-b1ce.up.railway.app";

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizePublicUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!trimmed) return "";
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/iu.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function readReplitDomainUrl() {
  const domains = readTrimmedEnv("REPLIT_DOMAINS");
  if (!domains) return "";
  const first = domains.split(",").map((d) => d.trim()).find(Boolean);
  if (!first) return "";
  return normalizePublicUrl(first);
}

export function readPublicAppUrl() {
  const configured = normalizePublicUrl(readTrimmedEnv("PUBLIC_APP_URL"));
  const replitDomainUrl = readReplitDomainUrl();
  const railwayPublicDomain = normalizePublicUrl(readTrimmedEnv("RAILWAY_PUBLIC_DOMAIN"));
  const railwayStaticUrl = normalizePublicUrl(readTrimmedEnv("RAILWAY_STATIC_URL"));

  // On Replit, REPLIT_DOMAINS is environment-specific (dev preview vs deployment),
  // so prefer it over PUBLIC_APP_URL (which is shared across environments and
  // would otherwise leak the dev URL into production emails).
  if (replitDomainUrl) return replitDomainUrl;

  if (configured && configured !== LEGACY_PUBLIC_APP_URL) return configured;

  if (railwayPublicDomain) return railwayPublicDomain;
  if (railwayStaticUrl) return railwayStaticUrl;

  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_URL or REPLIT_DOMAINS must be set in production.");
  }

  return LOCAL_PUBLIC_APP_URL;
}

export function buildPublicAppUrl(path: string) {
  try {
    return new URL(path, readPublicAppUrl()).toString();
  } catch {
    return readPublicAppUrl();
  }
}
