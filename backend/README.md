# Transport: Sydney Live server

The API behind the Transport: Sydney Live apps for iPhone and Android: live departures, trip plans with live times, followed trips with alerts, morning checks, occupancy, lift aware trips and plain questions, all from Transport for NSW open data. It is a Cloudflare Worker with a D1 database, a Cron Trigger for the minute tick and an optional R2 bucket for the Android APK.

Live at **https://api.transportsydney.app**. Public site: https://transportsydney.app (`../site/`). Publisher: Fintex Australia Pty Ltd, https://fintex.au.

| Path | What |
| --- | --- |
| `src/worker.js` | The whole server. Tables are created on first use; `migrations/0001_init.sql` is generated from it |
| `src/public/` | Data the server reads (stations, stops, facilities), the shared live trip page `live/`, and the older web app files (served only on the first address until the switch) |
| `test/` | Node tests (`node --test test/*.test.mjs`), real SQL through `node:sqlite` |
| `build.mjs` | `--cloudflare`: `dist/worker.mjs` and `dist/public` for wrangler |
| `wrangler.toml.template` | Worker config; `tools/render-wrangler.mjs` fills the account and database ids from the environment |
| `tools/deploy-cloudflare.sh` | Tests, build, D1, migrations, secrets, deploy |
| `tools/deploy-site.mjs` | `../site/` to Cloudflare Pages with domains, DNS and the www redirect |
| `tools/setup-email.mjs` | support@, privacy@ and hello@transportsydney.app forwarding |
| `tools/schema.mjs` | Writes the D1 migration from the worker |
| `tools/export-d1.mjs` | Copies the first deploy's data into a SQL file for the new database |

Endpoints and response shapes: [docs/API.md](../docs/API.md). Deploy and the switch: [docs/DEPLOY_CLOUDFLARE.md](../docs/DEPLOY_CLOUDFLARE.md). Operations: [docs/RUNBOOK.md](../docs/RUNBOOK.md). Secrets: [docs/SECURITY.md](../docs/SECURITY.md) (never in the repo).

Live data: Transport for NSW Open Data, CC BY 4.0. An independent app, not made or endorsed by Transport for NSW.
