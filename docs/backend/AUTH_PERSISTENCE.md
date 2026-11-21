# Auth & Persistence

## Auth model

- Passwords: scrypt hash + per-user salt (`account-store.ts`). Never stored or logged in plaintext.
- Sessions: random token → SHA-256 hash stored server-side; `cowboy_session` cookie is `HttpOnly; SameSite=Strict; Secure` (prod), `Path=/`, 7-day Max-Age.
- Duplicate cookie names are rejected (never guess identity). `GET /api/account` resolves user from session hash.
- Mutations: `assertSameOrigin` (Origin host+protocol must match Host/x-forwarded-proto, `sec-fetch-site: cross-site` rejected) + `MutationLimiter` (10/15min per key, 60/15min global).
- Bodies: `readJson` — JSON only, strict field allowlist, 4KB cap.
- Recovery: email verify + password reset via single-use hashed tokens (`verify_email`, `password_reset` purposes, expiry + consumedAt).
- Authorization: every pick/parlay/follow/token operation resolves `userId` from the session token — users can only touch their own rows. `awardTokens`/`adjustTokens` enforce self-award rules.
- Anonymous: consensus/leaderboard are aggregate-only; picks require auth (401 otherwise). No anonymous draft persistence — draft state is client-side only by design.

## Persistence architecture

Two `AccountBackend` implementations behind `getAccountBackend()`:

| | `SupabaseStore` (production) | `AccountStore` (local/tests) |
|---|---|---|
| Selection | `supabaseConfig()` env present | fallback / `setAccountBackend` |
| Users, sessions, tokens | `cowboy_users`, `cowboy_sessions` (RPC) | JSON file, atomic rename, queued writes |
| Picks/parlays | `cowboy_picks`, `cowboy_parlays` + RPC save/settle | same shape in StoreData |
| Chips | `cowboy_adjust_tokens` signed RPC, `award_key` idempotent | ledger array, same semantics |
| Follows, contests, leaderboard | Supabase tables/RPCs | StoreData arrays |

Data survives restarts: Supabase is durable Postgres; local store is fsynced JSON with schema validation on load (`validateStore` rejects corrupt data rather than silently resetting).

## API surface

`AccountBackend` (`store-backend.ts`) is the single contract: register/login/getUser/logout/deleteAccount/revokeOtherSessions, follows get/set, exportAccount, listPicks/listParlays/savePicks/saveParlay/settlePicks/settleParlays/changePick, consensus, publicLeaderboard, setLeaderboardOptIn, contests, tokens (get/award/adjust), email verify/reset.
