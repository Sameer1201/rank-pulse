# D1 Query Optimization: 2026-09-22

## Status and scope

Implemented, tested and deployed on 2026-09-22. **Both additive index migrations are applied to their respective production D1 databases; API and frontend are live.** Two query samples were measured before/after on D1 (see rollout results below). This report does not claim every application query is now bounded or that the 5M/day budget is guaranteed.

Reviewed the production API Worker, the separate QBank proxy/database boundary, corresponding Express routes, schema/migrations, frontend callers, authentication lookups, submissions, dashboards, progress, saved questions, reports, polling and activity paths. Preserved existing response semantics except for opt-in pagination consumed by the updated frontend. No business data was modified or deleted by the migrations. Live smoke testing performed a normal login/logout, not student submissions or admin mutations. No index was removed.

Main D1 owns users, metadata, tests, submissions and sessions. QBank D1 owns questions, progress, bookmarks, reports and test-question links. Normal QBank paths in the regression tests run against a separate SQLite database, not the main fixture's legacy tables. This pass does not repeat the earlier database separation or remove legacy tables.

`D1_SCHEMA_INVENTORY.json` contains every table, column, type, default, primary-key ordinal, foreign key, unique/index definition and indexed expression from the repository baselines: 29 main-baseline tables/49 indexes and 5 QBank tables/15 indexes. These counts include SQLite constraint indexes. This is **not** a snapshot of the live accounts. Regenerate with Node 22+:

```sh
node scripts/audit-d1-schema.mjs > artifacts/api-server/D1_SCHEMA_INVENTORY.json
```

## Top 10 high-cost patterns

Ranked by potential growth/execution frequency, not by invented production measurements. `N` is table size, `P` is requested page size, `S` is one student's history, and `Q` is the required question set.

| Priority | Query / tables | Why expensive; scan status | Change or remaining limit |
| --- | --- | --- | --- |
| 1 | Global analytics: submissions grouped by test; `test_submissions`, `tests`, `users` | Exact all-time metrics still read all relevant submissions. Repeated JS filtering was also O(tests x submissions), and all student profiles were loaded for eight leaders. | Group submissions once; fetch only the eight required profiles. CPU/profile reads improve; the exact submission scan remains. |
| 2 | Super-admin summaries and DB viewer/export `COUNT(*)`, substring search, deep `OFFSET` | Exact global summaries touch growing datasets. DB viewer enumerates/counts multiple tables; `%term%` search is generally not a B-tree seek. | No inaccurate cached totals or truncated exports introduced. Still expensive, on-demand administrative operations. A complete global progress count in these tools is not a student-dashboard requirement. |
| 3 | Whole-exam/class QBank tree and exports | Fetching a whole selected bank grows with its question count; images/solutions made intermediate responses large. Large placeholder lists also exceeded D1 limits. | Lean projections, opt-in images/explanations, JSON ID sets, one-pass grouping. Normal student navigation uses structure/chapter paths. Full exports intentionally remain proportional to the requested export. |
| 4 | QBank exam/structure `COUNT(*) ... GROUP BY class_id/chapter_id` | Indexed scope avoids unrelated banks but exact counts still read the relevant questions/progress. | Reuse existing class/chapter/student indexes. Do not add an index per count or silently replace real counts with estimates. Remaining cost scales with selected banks. |
| 5 | `SELECT ... FROM question_bank_question_progress WHERE student_id = ?` for summary | Previously returned every progress object and did repeated JS scans/date conversion. It was student-scoped, not a global full scan. | One exact aggregate result for lifetime totals and 14 UTC days. Numeric timestamp comparisons replace repeated date conversions. DB still visits S rows; payload changes from S records to one result. |
| 6 | Review Bucket: latest submissions and corresponding questions | Student history can grow indefinitely; repeated answer/timing JSON parsing multiplied CPU work by question count. Summary fetched unnecessary detail/report data. | Parse each selected submission once; summary omits timings/images/report query; fetch required test sets via JSON IDs. Existing student-history index retained. History and required-question reads remain, not constant-time. |
| 7 | Saved questions list and dashboard badge | Previously loaded the complete saved content for a count; legacy Express did per-question context lookups. | Dashboard count-only query; keyset list pages <=100; only page question/progress/metadata sets; Express context joins replace N+1 calls. Exact saved count still reads the student's matching index entries. |
| 8 | Global report queue `ORDER BY created_at DESC, id DESC` | Before the new index: full report scan plus temporary sort. All reports/question content/reporters were fetched. | New ordered index, keyset page <=100, batch only page question text/reporters. Page cost becomes bounded by the page and related records rather than all reports. |
| 9 | Test grading and test-to-QBank sync | Grading fetched unused images/solutions. Sync fetched existing counters and emitted two writes per answered linked question; large tests could exceed proxy batch limits. | Narrow grading projection. Two set-based SQL writes in one QBank transaction; atomic counter increments, preserved prior solve/attempt state, and link repair. Still writes each required progress/link row. |
| 10 | Auth/pending-user/session lookups | `lower(email)`/`lower(username)` need matching expression indexes. Pending queue formerly used role-only index and then filtered status. Session ordering needs a user/time index. | Keep existing expression/session indexes, bring expression indexes into fresh schema definitions, add role+status+time index. PK lookups need no additional index. No case-format/backfill changes. |

## Index decisions and exact SQL

Only two new index definitions are required by this pass. Both migrations use `IF NOT EXISTS`, were applied twice to disposable fixtures, preserve rows and pass integrity checks.

Main database, `migrations/20260921_main_pending_users_index.sql`:

```sql
CREATE INDEX IF NOT EXISTS "users_role_status_created_at_id_idx"
  ON "users" ("role", "status", "created_at", "id");
```

Helps `WHERE role='student' AND status='pending' ORDER BY created_at,id`. The existing `(role,created_at,id)` index is not equivalent: it must visit all students to test status. Retained that index for role-only lists, whose ordering would not be covered by inserting status into the middle.

QBank database, `migrations/20260921_qbank_report_cursor_index.sql`:

```sql
CREATE INDEX IF NOT EXISTS "question_bank_reports_created_at_id_idx"
  ON "question_bank_reports" ("created_at" DESC, "id" DESC);
```

Helps the global report queue. Existing `(question_id,created_at,id)` and `(teacher_id,status,created_at,id)` indexes cannot supply the same global ordering. Those indexes remain for their own scoped queries. The new definition is also included in the QBank fresh-schema file and Drizzle/main legacy schema for local compatibility.

These **existing** September 19 migration definitions were added to fresh schema/Drizzle definitions, not duplicated under new names:

```sql
CREATE INDEX IF NOT EXISTS "users_lower_email_idx" ON "users" (lower("email"));
CREATE INDEX IF NOT EXISTS "users_lower_username_idx" ON "users" (lower("username"));
```

No stored email or username was normalized/backfilled; user-visible formatting, authentication semantics and existing uniqueness constraints are unchanged. Both arms of the OR lookup use their own expression indexes. A new case-insensitive UNIQUE constraint was deliberately not introduced without checking existing data for collisions.

Existing indexes reused rather than duplicated:

| Index | Columns / purpose |
| --- | --- |
| `test_questions_test_id_order_id_idx` | `(test_id,order,id)`: ordered questions for one test |
| `test_submissions_student_id_submitted_at_id_idx` | `(student_id,submitted_at,id)`: ordered student history |
| `test_submissions_test_id_student_id_submitted_at_id_idx` | `(test_id,student_id,submitted_at,id)`: latest/student test attempts |
| `user_sessions_user_id_last_active_at_id_idx` | `(user_id,last_active_at,id)`: recent sessions |
| `classes_workflow_type_title_id_idx` | `(workflow_type,title,id)`: ordered QBank classes |
| `question_bank_questions_chapter_id_order_created_at_id_idx` | `(chapter_id,order,created_at,id)`: chapter questions |
| `question_bank_question_progress_unique` | `(question_id,student_id)`: exact progress lookup/upsert |
| `question_bank_question_progress_student_id_class_id_id_idx` | `(student_id,class_id,id)`: student/scoped progress |
| `question_bank_saved_questions_student_id_created_at_id_idx` | `(student_id,created_at,id)`: saved cursor pages |
| `test_question_bank_links_test_id_question_idx` | `(test_id,test_question_id,question_bank_question_id)`: linked test set |

No existing index was dropped. Older migrations contain their own historical DROP statements; this report does not authorize blindly re-running those migrations on production.

## Verified query plans

Generated by `tests/d1-query-plans.test.mjs` using real SQLite and repository schema. The pending-student and report-cursor before/after plans were additionally verified on production D1; other listed plans remain local verification.

| Pattern | Before | After / existing verified plan |
| --- | --- | --- |
| Pending students | `SEARCH users USING INDEX users_role_created_at_id_idx (role=?)` | `SEARCH users USING INDEX users_role_status_created_at_id_idx (role=? AND status=?)`; no temp sort |
| Report cursor | `SCAN question_bank_reports; USE TEMP B-TREE FOR ORDER BY` | `SEARCH question_bank_reports USING INDEX question_bank_reports_created_at_id_idx (created_at<?)` |
| `users.id` / `subjects.id` | Already PK-backed | `SEARCH ... USING INTEGER PRIMARY KEY (rowid=?)` |
| Lowercase email | Expression index in prior migration | `SEARCH users USING COVERING INDEX users_lower_email_idx (<expr>=?)` |
| Lowercase username OR email | Both expressions indexed | `MULTI-INDEX OR` using both expression indexes |
| Ordered test questions | Existing composite index | `SEARCH test_questions ... (test_id=?)`; no temp sort |
| Student history / sessions | Existing user/time indexes | Indexed search on `student_id` / `user_id`; no temp sort |
| Saved cursor | Existing student/time index | `SEARCH ... (student_id=? AND created_at<?)` |
| Batched question progress | Repeated joins/large placeholder lists | `SEARCH ... question_bank_question_progress_unique (question_id=? AND student_id=?)` |

The last query also reports `SCAN json_each VIRTUAL TABLE`: that scans only the requested in-memory ID list, not the whole progress table. An indexed scan for a first ordered page is not automatically bad either; LIMIT stops it after the requested page.

## Query and end-to-end improvements

- `SELECT *` replaced for test grading, list/export QBank projections, report question text, saved metadata/progress and top analytics profiles. Full rows retained where downstream logic needs them, including complete user authentication state and explicit exports.
- Images are not fetched from D1 just to discard them in the application. SQL image-presence flags correctly handle empty strings/arrays. Full export images/explanations are retained when requested.
- Saved/report keyset cursors include both timestamp and ID, so tied timestamps neither duplicate nor omit rows. No deep OFFSET on these paths. Legacy no-limit callers retain their supported response shapes.
- Large question/test/reporter ID sets use one JSON-bound parameter and indexed `IN (SELECT value FROM json_each(?))`, avoiding the 100-bound-parameter limit without one network call per ID.
- Saved questions/progress are loaded together; only required metadata IDs are requested across the main/QBank boundary. Express saved pages use at most three queries including student and class checks in the fixture, rather than per-question context calls.
- For the 150-question sync fixture, the new path uses exactly **two write statements**, rather than the previous two per candidate (300). This is a statement-count improvement, **not** a claim of 99% fewer D1 rows written/read. Each required progress row still changes, and indexes have write overhead.
- QBank progress/link updates are transactional within QBank. Main submission + remote QBank sync are not a cross-database transaction; the existing best-effort error handling remains. A proxy outage can still leave a completed submission needing a retry/reconciliation. No durable outbox was silently introduced.
- No score is trusted from the client; server grading remains in place. Role/student scoping and existing approval/feature rules in the touched Express paths are retained. No new answer fields or private user fields were exposed.

## Counts, caching and polling

The saved badge now calls an exact student-scoped COUNT, not the full saved-content endpoint. Progress summary returns exact lifetime/daily aggregates and is not limited to the current page. Report pagination does not pretend the loaded page count is a global count; an unused local open-report statistic was removed.

Exact global dashboard/analytics/export counts were not converted to stale cached values. An index does not make every COUNT constant-time; lifetime per-student aggregates still scale with that student's matching rows. No global counter/backfill/trigger system was introduced without complete write-path coverage.

No new shared Worker/CDN cache was introduced for private data, answers, authentication or progress. Existing React Query freshness policy was retained (saved data/count: 60 seconds), with bookmark mutation invalidation. New saved/report query keys include user identity (report keys also role), preventing those caches being reused across account switches. This is in-memory browser caching, not a public cache. Existing image caching policy elsewhere was not changed.

Activity heartbeat and security logs were inspected but not removed: the tracker sends a 60-second heartbeat, and notification fallback polling is five minutes in the existing code. Those settings are not new savings from this pass. Concurrent tabs and failed realtime reconnects remain worth measuring; reducing their semantics without measurement was avoided.

## Scalability and the 5M daily budget

At 10k, 50k, 100k or 1M+ rows, a primary-key/index seek still targets a key/range rather than all unrelated rows. Saved/report page work is approximately O(log N + P) plus related page lookups, with P capped at 100. Test work is proportional to the test's required Q questions. Pending approvals read the pending range instead of every student. Exact history/count/export/analytics work still grows with its defined result domain.

These are algorithmic expectations, not measured D1 billing counters. Smaller column projections primarily improve transferred bytes, JSON work and latency; they do **not** automatically reduce D1 rows-read. SQLite EXPLAIN does not supply production D1 `meta.rows_read`, traffic frequency, network latency or p95 browser timings.

Most important budget controls are: deployed matching indexes; eliminating all-content fetches for badges/lists; limiting pages; avoiding per-question network calls; and measuring frequency of exact global analytics/counts. Estimate daily cost from `sum(calls_per_day * observed_rows_read_per_call)` per account, including background/polling requests. Keep headroom rather than targeting exactly 5M. This pass cannot guarantee the budget at arbitrary traffic or invent an optimization percentage.

Cloudflare documents [indexes and EXPLAIN](https://developers.cloudflare.com/d1/best-practices/use-indexes/), [bound-parameter/query limits](https://developers.cloudflare.com/d1/platform/limits/) and [row-based usage pricing](https://developers.cloudflare.com/d1/platform/pricing/). Measure live query metadata before/after rollout and recheck the highest frequency fingerprints, not just rows returned.

## Verification

- 60 API tests pass: 43 existing tests plus 14 optimization/pagination/query-plan tests and 3 adapter contract tests. Covers saved counts and equal-timestamp pages, teacher report restrictions, UTC progress totals, separate-QBank state, 150-question grading/sync, rollback on QBank link failure, 110 attempted-test Review Bucket history, analytics metrics, auth/session/payment/review-email regressions, new index plans, and Drizzle positional/empty/batch result mapping.
- Full workspace TypeScript check passes, including libraries, API, frontend, mockup sandbox and scripts.
- Frontend production build passes.
- Node API build and production Cloudflare Worker build pass (esbuild transpilation is not a substitute for type checking).
- Fixed the database export's lost Drizzle type inference, JSON request narrowing, SQL result typing and shared-client build environment types. No `ts-ignore` or disabled strictness was used.
- No lint script/configured lint command is supplied by the affected packages; lint is not claimed as passed.
- Additive migration tests: both scripts applied twice, results/data unchanged, integrity checks pass; QBank foreign-key check passes.
- `git diff --check` passes. Existing unrelated dirty files were not reverted.
- 23 live HTTP smoke checks pass, including legitimate login, session restoration, QBank exams/reports, tests list, super-admin dashboard, logout, anonymous access denial, API-to-D1 health, Pages API proxy, QBank proxy access denial and the newly built frontend asset. Credentials/cookies and private response bodies were not written to verification logs.
- Interactive browser verification was unavailable because computer-use permissions were pending. Student submission and all admin mutations were not exercised on production; no artificial test attempts were added to real student histories. Local regression coverage is not a claim of complete live end-to-end coverage.

## Production rollout results

Both account/database identities and existing indexes were checked before mutation. Fresh D1 Time Travel recovery bookmarks were recorded in the migration manifests before each additive index creation. These are recovery points, not offline SQL backups. No baseline schema, data backfill, DROP or DELETE was run. Each migration was followed by `PRAGMA optimize` and live EXPLAIN verification.

| Target | Measurement | Before | After | Interpretation |
| --- | --- | --- | --- | --- |
| Main `rank` | Pending-student query, 1 returned row | 4 rows read; 0.2800 ms SQL | 2 rows read; 0.5493 ms SQL | Role+status index narrows the search; tiny timing sample is not a speed benchmark. |
| Separate `qbank` | Report cursor, 0 returned rows | 2 rows read; 0.3723 ms SQL | 1 row read; 0.3024 ms SQL | Full scan/temp sort replaced by indexed range; empty queue is not representative load. |

No overall percentage savings, p95 improvement or daily 5M budget guarantee can be inferred from these small samples. Real traffic monitoring remains necessary, particularly for exact global analytics and growing per-student histories.

- Main migration evidence: `verification/20260922/main-migration-1790066811577.json`.
- QBank migration evidence: `verification/20260922/qbank-migration-1790066851459.json`.
- Production API: https://rankpulse-api.rankpulsee.workers.dev ; version `5eb5384a-954c-4132-8338-3d6231bb9ac4`. Deployed with `--keep-vars`, preserving remote variables/secrets. Explicit production Worker name prevents accidentally creating a suffixed Worker.
- Previous API version: `f4c4c9bc-f229-4be0-8130-10048ed38421`.
- Production frontend: https://rank-cu1.pages.dev ; deployment https://8f93b826.rank-cu1.pages.dev (project `rank`, production branch `main`). Includes the Pages Functions API proxy. API was deployed first.
- Previous frontend deployment: `94608d7c-78c9-434e-8285-898d698c6752`.
- Deployment logs, typecheck/build/test logs and privacy-minimized live smoke results are in `verification/20260922/`.
- QBank proxy code was unchanged and was not unnecessarily redeployed. Its separate D1 report index was applied; authenticated application QBank reads succeeded after the API rollout.

Remaining boundaries: production student write flows were not artificially exercised, main-to-QBank synchronization remains best-effort across databases, and exact global counts/analytics are still proportional to the data requested. These are not hidden behind a claim that every historical feature issue is resolved.

## Files changed in this optimization pass

- `artifacts/api-server/src/cloudflare-worker.ts`: scoped projections, paging/counts, aggregates, JSON-ID batches, Review Bucket CPU/summary improvements, analytics grouping and transactional test-progress sync.
- `artifacts/api-server/src/routes/questionBank.ts`: compatible Express cursor/count responses, saved-context N+1 removal, narrow report lookups.
- `artifacts/api-server/migrations/20260921_main_pending_users_index.sql`: pending-user index.
- `artifacts/api-server/migrations/20260921_qbank_report_cursor_index.sql`: report cursor index.
- `artifacts/api-server/migrations/20260920_question_bank_database.sql`: fresh QBank report-index definition.
- `lib/db/src/schema/users.ts`: pending/expression index definitions.
- `lib/db/src/schema/question_bank.ts`: report index definition.
- `lib/db/src/d1Schema.ts`: equivalent fresh/local schema definitions.
- `artifacts/edtech/src/pages/admin/QuestionBank.tsx`: report pagination, user-scoped cache, load-more, export explanation opt-in, unused statistic removal.
- `artifacts/edtech/src/pages/student/question-bank/api.ts`: saved infinite query/count hook and identity-scoped cache keys.
- `artifacts/edtech/src/pages/student/question-bank/SavedQuestions.tsx`: page flattening, load-more and count invalidation.
- `artifacts/edtech/src/pages/student/question-bank/QuestionPage.tsx`: invalidate saved count on bookmark changes.
- `artifacts/edtech/src/pages/student/question-bank/ChapterPage.tsx`: invalidate saved count on bookmark changes.
- `artifacts/edtech/src/pages/student/question-bank/Dashboard.tsx`: exact count-only saved badge.
- `artifacts/api-server/package.json`: explicit D1 development types and reproducible test command.
- `pnpm-lock.yaml`: dependency resolution for the Worker types.
- `artifacts/api-server/tests/d1-query-optimization.test.mjs`: real Worker/SQLite integration regressions.
- `artifacts/api-server/tests/question-bank-pagination.test.mjs`: actual Express/Drizzle compatibility and scope regressions.
- `artifacts/api-server/tests/d1-query-plans.test.mjs`: index usage, migration idempotency, data/integrity checks.
- `scripts/audit-d1-schema.mjs`: reproducible, read-only repository schema inventory generator.
- `lib/db/src/index.ts`: preserve inferred Drizzle database type and forward batch query methods.
- `lib/db/src/d1.ts`: type-safe positional rows while retaining undefined for an absent get result.
- `lib/db/package.json`: Node development types; corresponding lockfile update.
- `lib/api-client-react/src/custom-fetch.ts`: safely typed optional build environment without requiring Vite globals in the shared library.
- `artifacts/api-server/src/routes/auth.ts`: typed full-user login lookup preserving matching rules and serialization.
- `artifacts/api-server/src/routes/analytics.ts`: accurately typed selected leaderboard profile columns.
- `artifacts/api-server/src/routes/dataTransfer.ts`: typed whitelisted SQLite table for dynamic updates.
- `artifacts/api-server/wrangler.toml`: explicitly target the existing production Worker.
- `artifacts/api-server/tests/d1-adapter.test.mjs`: actual adapter get/all/batch result-contract regressions with mocked transport.
- `scripts/apply-d1-optimization.mjs`: identity-checked additive migration and before/after/recovery evidence capture.
- `scripts/with-cloudflare-token.mjs`: hidden terminal credential input without embedding secrets in source or logs.
- `scripts/verify-production-optimization.mjs`: read-only endpoint checks plus optional legitimate login/logout; no persisted credentials or private response bodies.
- `verification/20260922/*`: migration, deployment, build, typecheck, test and live smoke evidence.
- `artifacts/api-server/D1_SCHEMA_INVENTORY.json`: generated columns/keys/index inventory.
- `artifacts/api-server/D1_OPTIMIZATION_REPORT.md`: this report.
- Generated `artifacts/edtech/dist/public/*` and `artifacts/api-server/dist/*`: rebuilt outputs, not independent source changes. Other pre-existing dirty files are outside this pass.
