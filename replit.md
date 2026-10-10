# RankPulse — EdTech Platform

A full-stack EdTech platform for competitive exam preparation (JEE, NEET, GATE, IIT-JAM, etc.) with question banks, timed tests, student analytics, and a teacher/admin dashboard.

## Stack

- **Frontend** (`artifacts/edtech`): React 19 + Vite, TailwindCSS v4, Radix UI, TanStack Query, Wouter routing, Firebase Auth
- **Backend** (`artifacts/api-server`): Node.js + Express, TypeScript, Drizzle ORM, Cloudflare D1
- **Shared libs**: `lib/db` (schema + Drizzle client), `lib/api-zod` (Zod validators), `lib/api-client-react` (typed React hooks)
- **Package manager**: pnpm workspaces

## How to run

Install dependencies once after importing, then use the **Project** run button. It starts the frontend and API in parallel:

```bash
corepack pnpm install --frozen-lockfile
```

| Workflow | Command | Port |
|---|---|---|
| `RankPulse API` | `./run-api.sh` | 8080 |
| `Start application` | `./run-edtech.sh` | 5000 |

The artifact workflows use the equivalent package commands directly. The Vite dev server proxies `/api` → `http://localhost:8080`.

## Cloudflare Pages frontend

Deploy the frontend from `artifacts/edtech` as a Cloudflare Pages site:

- Build command: `pnpm --filter @workspace/edtech build:pages`
- Build output directory: `artifacts/edtech/dist/public`
- SPA fallback: handled by `artifacts/edtech/public/_redirects`
- API proxy on Pages: handled by `artifacts/edtech/functions/api/[[path]].ts`
- Set `API_ORIGIN` in Pages environment variables to the deployed API origin, for example `https://api.yourdomain.com`

Local development still uses the Vite proxy to `http://localhost:8080`, so the same `/api/*` paths continue to work while developing.

## Environment variables

Set in Replit Secrets / env vars (shared):

| Key | Description |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | Cloudflare D1 database ID |
| `CLOUDFLARE_API_TOKEN` | Replit Secret with permission to query the D1 database |
| `PYQ_PROXY_URL` | URL of the dedicated PYQ Cloudflare Worker in the second account |
| `PYQ_PROXY_TOKEN` | Shared secret between the API server and dedicated PYQ Worker |
| `SESSION_SECRET` | Cookie signing secret (set as Replit Secret) |
| `NODE_ENV` | `development` |

Optional (payment, email, Firebase):
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` (Gmail SMTP; use a Google App Password)
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, etc.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (or `FIREBASE_SERVICE_ACCOUNT_JSON`)
- `FIREBASE_WEB_API_KEY` (for Firebase Auth token verification fallback)

## Database

Uses Cloudflare D1 through the Cloudflare REST API. The API server initializes
the idempotent SQLite schema on startup, so no PostgreSQL connection string or
Drizzle Kit push step is required.

## Default seeded accounts

Seed passwords must be supplied through environment variables. No default password is stored in this repository.

| Username | Role | Email |
|---|---|---|
| `Sameer` | super_admin | Rankpulsee@gmail.com |
| `Admin` | admin (teacher) | priya@educonnect.com |
| `Student` | student | rahul@educonnect.com |

## User preferences

- Keep project structure as-is (monorepo with `artifacts/` and `lib/`)
- Do not migrate or replace the database unless explicitly asked
