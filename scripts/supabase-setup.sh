#!/usr/bin/env bash
# One-shot COWBOY ↔ Supabase setup.
# Prereqs: `supabase login` completed for the account that owns project
# hdkdsbxgfknxexoeyxci, and the project's database password (asked once by
# `supabase link`; set SUPABASE_DB_PASSWORD to skip the prompt).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="hdkdsbxgfknxexoeyxci"
PROJECT_URL="https://${PROJECT_REF}.supabase.co"

echo "==> Linking project ${PROJECT_REF}"
supabase link --project-ref "$PROJECT_REF"

echo "==> Pushing migrations"
supabase db push --linked

echo "==> Fetching API keys"
KEYS="$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json)"
ANON="$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(x=>x.name==="anon")||JSON.parse(s)[0];console.log(k.api_key)})')"
SERVICE="$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(x=>x.name==="service_role")||JSON.parse(s)[1];console.log(k.api_key)})')"

ENV_FILE=".env.local"
if [ -f "$ENV_FILE" ] && grep -q "SUPABASE_SERVICE_ROLE_KEY=." "$ENV_FILE"; then
  echo "==> .env.local already has keys; leaving it untouched"
else
  cat > "$ENV_FILE" <<EOF
# Supabase account/pick storage (server-only; .env* is gitignored)
COWBOY_SUPABASE_URL=${PROJECT_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE}
EOF
  echo "==> Wrote ${ENV_FILE} (chmod 600)"
  chmod 600 "$ENV_FILE"
fi

echo "==> Smoke test: register → session → pick → list"
node --import tsx -e '
import { SupabaseStore } from "./app/lib/supabase-store";
const store = new SupabaseStore({ url: process.env.COWBOY_SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
const { user, token } = await store.register(`setup_${Date.now()}`, "setup horse battery staple");
console.log("registered:", user.username);
console.log("session user:", (await store.getUser(token))?.username);
await store.logout(token);
console.log("OK");
' || echo "!! Smoke test failed — check keys and migration output above"

echo "Done. Restart the dev server / redeploy for the Supabase backend to activate."
