#!/usr/bin/env bash
# Deploys the Transport: Sydney Live API to the Fintex Cloudflare account (api.transportsydney.app).
# Needs in the environment, never in the repo: CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID.
# Optional: D1_DATABASE_ID (found or created by name "transport" when unset), R2_BUCKET.
# Flags: --secrets  also upload the Worker secrets from the environment or backend/.env
#        --dry-run  build and check everything, deploy nothing
# Full steps, DNS and the switch: docs/DEPLOY_CLOUDFLARE.md
set -euo pipefail
cd "$(dirname "$0")/.."
SECRETS=0; DRY=0
for a in "$@"; do case "$a" in --secrets) SECRETS=1;; --dry-run) DRY=1;; *) echo "unknown flag $a"; exit 2;; esac; done
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
WR=(npx --yes wrangler@4)

echo "1. Tests and checks"
node tools/schema.mjs --check
node --test test/*.test.mjs > /tmp/transport-tests.log 2>&1 || { tail -40 /tmp/transport-tests.log; exit 1; }
grep -E "^# (pass|fail)" /tmp/transport-tests.log
if grep -rnP "\x{2013}|\x{2014}" src/ ../site/ ../docs/DEPLOY_CLOUDFLARE.md; then echo "fix dashes first"; exit 1; fi

echo "2. Build"
node build.mjs --cloudflare dist

echo "3. D1 database"
if [ -z "${D1_DATABASE_ID:-}" ]; then
  find_db() { "${WR[@]}" d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const d=l.find(x=>x.name==="transport");if(d)console.log(d.uuid)})'; }
  D1_DATABASE_ID="$(find_db)"
  if [ -z "$D1_DATABASE_ID" ]; then
    [ "$DRY" = 1 ] && D1_DATABASE_ID="00000000-0000-0000-0000-000000000000" || { "${WR[@]}" d1 create transport --location oc >/dev/null; D1_DATABASE_ID="$(find_db)"; }
  fi
fi
export D1_DATABASE_ID
node tools/render-wrangler.mjs

if [ "$DRY" = 1 ]; then
  "${WR[@]}" deploy --dry-run --outdir /tmp/transport-dry
  echo "Dry run done, nothing deployed."; exit 0
fi

echo "4. Schema"
"${WR[@]}" d1 migrations apply DB --remote

if [ "$SECRETS" = 1 ]; then
  echo "5. Secrets"
  for k in TFNSW_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY TICK_KEY ADMIN_KEY; do
    v="${!k:-}"
    if [ -z "$v" ] && [ -f .env ]; then v="$(grep -E "^$k=" .env | head -1 | cut -d= -f2-)"; fi
    [ -n "$v" ] || { echo "missing $k"; exit 1; }
    printf '%s' "$v" | "${WR[@]}" secret put "$k" >/dev/null
    echo "  $k set"
  done
fi

echo "6. Deploy"
"${WR[@]}" deploy
echo "Check: curl -s https://api.transportsydney.app/api/status"
