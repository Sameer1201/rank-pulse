# Dedicated PYQ Worker

This Worker owns the PYQ D1 database in the second Cloudflare account. The main API server is the only caller; browsers never receive `PYQ_PROXY_TOKEN`.

## First-time setup

1. Log Wrangler into the second Cloudflare account, or set `CLOUDFLARE_API_TOKEN` in the deployment environment.
2. Create a D1 database named `pyq` and put its ID in `wrangler.toml` in both D1 blocks.
3. Apply the schema and deploy:

```bash
pnpm install
pnpm exec wrangler d1 migrations apply pyq --remote
pnpm exec wrangler secret put PYQ_PROXY_TOKEN
pnpm exec wrangler deploy --env production
```

4. Configure the API server with the Worker URL and the same token:

```dotenv
PYQ_PROXY_URL=https://rankpulse-pyq.rankpulse-pyq.workers.dev
PYQ_PROXY_TOKEN=<same-secret>
```

For the Cloudflare-hosted API Worker, set the same values as Worker secrets/vars on that deployment as well (the API Worker must have `PYQ_PROXY_URL` and `PYQ_PROXY_TOKEN`).

Use a different long random token from the existing Question Bank proxy token. Keep all Cloudflare tokens in deployment secrets or `.env.local`; never commit them.
