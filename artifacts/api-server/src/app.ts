import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import compression from "compression";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, platformSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSignedUserId } from "./lib/authUtils";
import { authenticateNodeSession, nodeSessionEnv } from './lib/nodeSession';
import { allowedRequestOrigin } from './lib/workerRequestSecurity';

const app: Express = express();

// Gzip/Brotli compress all responses — cuts JSON payload sizes by ~70-80%
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const request = new Request(`${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`, {
    headers: { ...(origin ? { origin } : {}), ...(req.headers['sec-fetch-site'] ? { 'sec-fetch-site': String(req.headers['sec-fetch-site']) } : {}) },
  });
  if (!allowedRequestOrigin(request, { ...nodeSessionEnv, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL, CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS })) {
    res.status(403).json({ error: 'Untrusted request origin.' }); return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(cors({ origin: (origin, callback) => callback(null, origin || false), credentials: true }));
app.use(cookieParser());
app.use(authenticateNodeSession);
app.use((req, _res, next) => {
  if (/^\/api\/auth\/(login|google|firebase-email|register|registration-otp(?:\/.*)?|password-reset\/finalize|password-reset-link\/validate|forgot-password-request)$/.test(req.path)) {
    express.json({ limit: '64kb' })(req, _res, next); return;
  }
  const isLargeUpload =
    req.path === "/api/data-transfer/import/stream" ||
    req.path === "/api/data-transfer/import/chunk" ||
    req.path === "/api/data-transfer/import/finalize" ||
    req.path === "/api/data-transfer/import" ||
    req.path === "/api/data-transfer/import/users" ||
    req.path === "/api/tests/import";
  const isPsuTestImport = /^\/api\/psus\/\d+\/tests\/import$/.test(req.path);
  if (isLargeUpload || isPsuTestImport) {
    if (!['admin', 'super_admin'].includes(req.cookies?.userRole)) {
      _res.status(getSignedUserId(req) ? 403 : 401).json({ error: 'Administrative authentication is required before uploading.' }); return;
    }
    express.json({ limit: "500mb" })(req, _res, next);
  } else {
    express.json({ limit: "25mb" })(req, _res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// Keep the temporary student access pause enforceable at the API boundary too.
// The auth/session endpoints remain available so the countdown can refresh and
// priority access can be picked up immediately after an admin change.
app.use(async (req, res, next) => {
  const isExempt = [
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/registration-status",
    "/api/health",
  ].includes(req.path);
  if (isExempt) {
    next();
    return;
  }

  const userId = getSignedUserId(req);
  if (!userId) {
    next();
    return;
  }

  try {
    const [user, settings] = await Promise.all([
      db.select({ role: usersTable.role, priorityAccess: usersTable.priorityAccess }).from(usersTable).where(eq(usersTable.id, userId)),
      db.select({ registrationClosedUntil: platformSettingsTable.registrationClosedUntil }).from(platformSettingsTable).where(eq(platformSettingsTable.id, 1)),
    ]);
    const student = user[0];
    const closedUntil = settings[0]?.registrationClosedUntil;
    const closedAt = closedUntil instanceof Date ? closedUntil.getTime() : new Date(closedUntil as any).getTime();
    if (student?.role === "student" && !student.priorityAccess && Number.isFinite(closedAt) && closedAt > Date.now()) {
      res.status(423).json({ error: "Student access is temporarily paused.", closedUntil: new Date(closedAt).toISOString() });
      return;
    }
    next();
  } catch {
    // A settings read failure must not take the whole API offline.
    next();
  }
});

app.use("/api", router);

// In production, serve the built React frontend.
// The frontend builds to artifacts/edtech/dist/public, which is one level up from
// this package's directory at runtime (artifacts/api-server/).
const frontendDist = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "edtech",
  "dist",
  "public",
);

if (process.env.NODE_ENV === "production" && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { maxAge: "1y", immutable: true, index: false }));
  // SPA fallback — serve index.html for any non-API route so client-side routing works
  // Express 5 / path-to-regexp v8: unnamed groups like "(.*)" are rejected;
  // use a plain regex instead for the SPA catch-all fallback.
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  // Dev / fallback health check
  app.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
}

export default app;
