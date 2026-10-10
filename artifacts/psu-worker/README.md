# PSU Worker

Dedicated PSU content service for the separate Cloudflare account. PSU folders, imported HTML test bundles/metadata, and PSU question-bank questions are stored in this Worker-owned D1 database.

While logged into the new Cloudflare account, create the database first:

```bash
pnpm exec wrangler d1 create psu
```

Put the returned database ID in both D1 blocks in `wrangler.toml` (and add `account_id` if the Wrangler login is not being used), then run:

```bash
pnpm exec wrangler d1 migrations apply psu --remote
pnpm exec wrangler secret put PSU_PROXY_TOKEN
pnpm exec wrangler deploy --env production
```

Configure the main API server with the deployed Worker URL and the same token:

```dotenv
PSU_PROXY_URL=https://rankpulse-psu.<account-subdomain>.workers.dev
PSU_PROXY_TOKEN=<same-secret>
```
