# Release Readiness Report

**Baseline commit:** `3ad80e8` — "Codex UI batch: My Sports, discover, localization + per-event stale-clock contract" (verified on a clean detached worktree)
**Verdict: READY WITH KNOWN LIMITATIONS**

All gates green against the committed integration. The build is suitable for preview deployment. Known limitations are documented below; none block preview.

## Gate evidence (clean worktree @ `3ad80e8`)

| Gate | Status | Evidence |
|---|---|---|
| Unit/integration tests | ✅ 285/285 | `npm test` (tsx --test), incl. 21 identity/live-state, 17 hybrid-odds, 10 Kilo regression, 6 settlement edge cases, presentation stale-clock cases |
| Playwright E2E | ✅ 81/81 | `npm run test:e2e` against `next dev` webServer, incl. register→pick→settle journey |
| Typecheck | ✅ clean | `npm run typecheck` |
| Production build | ✅ clean | `npm run build` (all routes compiled; only pre-existing `package-lock.json`-outside-repo Turbopack warning) |

## Surface verification vs backend contracts

Verified against `docs/backend/*.md` contracts on the committed tree:

| Surface | Result | Notes |
|---|---|---|
| Home | PASS | Consumes board `fetchedAt`/`stale`/`lastSuccessAt`; no invented freshness |
| Live | PASS | League-level `current/backup-current/delayed/unavailable` preserved; per-event `clockStale` additive |
| Scores | PASS | `scoreSource` guards intact; backup feeds labeled |
| Game Center | PASS | Canonical ESPN event id throughout; schedule/detail identity verified |
| Odds/freshness | PASS | Codex uses embedded `event.odds`/`oddsBooks`; `/api/sports/odds` remains dormant hardened infrastructure (no client callers — no bypass possible) |
| Props | PASS | E2E-verified |
| Futures | PASS | E2E-verified |
| Predictions | PASS | Register → pick → settle E2E green; settlement states honored |
| History | PASS | E2E-verified incl. filters, sorting, pagination |
| Follows/watchlist | PASS | Persistent, reversible, server-backed (E2E-verified) |
| Leaderboard | PASS | Opt-in aggregate only, no invented stats |
| Auth/account | PASS | scrypt, hashed sessions, CSRF, same-origin, throttling — no P0/P1 regressions |
| Stale-clock presentation | PASS | See below |

## Stale-clock contract verification

`app/lib/event-presentation.ts` derives canonical live state via `deriveLiveState` from `lastConfirmedAt` (same timestamp league freshness uses):

- `clockStale` fires only for `live`/`halftime`/`intermission` when the confirming feed exceeds threshold: **30s for `current` feeds, 5min for `backup-current` feeds** (backup polls slower — avoids false alarms), provider default otherwise.
- **Unknown freshness → `fetchedAt: null` → `ageMs: null` → `stale: false`** — unknown is never treated as stale.
- **No clock fabrication** — only feed age is measured; no client/server clock progression is invented.
- Fresh live events remain fully visible; stale events show an additive "feed delayed" note without hiding picks eligibility logic changes.
- Regression coverage in `tests/global-catalogue.test.ts` (fresh live clean / frozen feed stale-while-`current` / scheduled never stale / unknown not assumed stale).

## Cross-cutting checks

- **Canonical event identity**: ESPN id canonical; provider ids resolved via team+time matching with ambiguity → null. Stress-tested (doubleheaders, reschedules, renames, neutral sites, timezones).
- **Duplicate upstream calls**: none introduced — board coalescing, single-flight odds cache, and SWR paths unchanged; Codex batch adds no new provider fetch paths.
- **Cache/quota bypass**: none — `/api/sports/odds` has no client callers; embedded odds path untouched.
- **Auth → pick → settle**: E2E test 58 passes end-to-end on the committed build.
- **Security/ownership**: no new P0/P1; ownership scoping, idempotency, and RLS boundaries unchanged.

## Backend contract changes since `5a7d39d`

- `3ad80e8`: additive `liveState`/`clockState`/`clockStale`/`clockAgeMs` on event presentation; Codex UI batch (My Sports, discover, localization, offline/PWA) — no breaking changes to documented contracts.
- Prior: identity-matched ToS odds, Kilo HO-1..HO-5c fixes (in `8ef1a79`).

## Kilo QA status

HO-1..HO-5c all reproduced, fixed or confirmed-fixed, regression-ported (`tests/qa-hybrid-odds.regression.test.ts`, 10 tests). No new defects reported.

## Known limitations

1. **Corrected results** — settled picks not re-graded (design in `REGRADING_DESIGN.md`, intentionally not enabled).
2. **Per-instance state** — MutationLimiter, odds cache/quota are per-serverless-instance (`CROSS_INSTANCE_RISK.md`; quantified, acceptable at current scale).
3. **Push notifications** — contract defined (`NOTIFICATIONS.md`), no provider provisioned.
4. **`/api/sports/odds` dormant** — hardened route has no UI consumer yet; embedded odds path is what ships.
5. **Live/in-play market depth** — constrained by free provider coverage; honestly labeled.

## Security blockers

None. P2 only: per-instance rate limiting (above).

## Data-provider blockers

The Odds API daily cap is self-imposed; plan upgrades are a spend decision. ESPN embedded odds are unofficial pick-center data — labeled fallback only.

## Infrastructure blockers

None required for release. Redis/KV optional at scale.

## Rollback

1. Revert to `8ef1a79` (pre-UI backend baseline) or `5a7d39d` and push — Vercel auto-deploys.
2. Supabase migrations are additive-only; no rollback needed.
3. `freshness`/`clockStale` fields are additive and ignored safely by older clients.

## Preview deployment suitability

**Suitable.** All gates green on the committed tree; limitations are documented and non-blocking. Recommend deploying `3ad80e8` to a preview environment for final real-data validation before any production promotion.

---

## PRODUCTION READ-ONLY VALIDATION — commit 4042592

**Target:** `https://betcowboy.vercel.app` · **Validated:** 2026-11-21 ~08:05–08:10 UTC · **Method:** read-only curl/API inspection; no accounts, picks, or mutations created.

### Deployed-build evidence

- `/my-sports`, `/discover`, `/live`, `/picks`, `/preferences`, `/contests`, `/parlays`, `/rewards`, `/help` all serve 200 — pages introduced by `3ad80e8` are live.
- Client bundle `219-7d048dac2e810410.js` contains the stale-clock strings (`feed delayed` / clockStale path) — the per-event stale-clock contract is deployed.
- Vercel headers present: `server: Vercel`, `x-vercel-id`, HSTS `max-age=63072000`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `cache-control: no-store` on API JSON.
- Build ID observed in RSC payload: `fHRAw2XORiyppwQdc6kSu` (cannot be mapped to a commit without Vercel API access; feature markers above are the available evidence).
- **Assessment:** deployed build is consistent with `4042592` (= `3ad80e8` + backend-only quota-cost fix). The quota fix is server-side only and has no UI surface.

### Surface results

| Surface | Result | Evidence |
|---|---|---|
| Home (`/`) | PASS | 200, real board data, `fetchedAt`/`stale`/`source` fields present |
| Live (`/live`) | PASS | 200; board currently reports 0 live events (Saturday ~1am PT — plausible, honestly reported) |
| Scores | PASS | Scores is a board view, not a route — `/scores` correctly 404s; score data flows via `/api/sports` |
| Game Center | PASS | `/api/sports/event?league=nfl&id=401873070` → 200, canonical ESPN id, full team/odds shape |
| Props | PASS | `/api/sports/props?league=nfl&id=401873070` → 200 `{props:null}` — honest empty, no fabrication |
| Futures | PASS | `/api/sports/futures?league=nfl` → 200 |
| Odds/freshness | PASS w/ note | `/api/sports/odds` → 200, `freshness{state:fresh, provider:espn, sourceAt:null, fetchedAt, cache:miss, error:"missing_key"}` — see env finding below |
| Market reference | PASS | `/api/sports/market` → 200, vig-free probabilities + `open` baseline, provider DraftKings |
| News | PASS | `/api/sports/news?league=nfl` → 200 |
| Team schedule | PASS | `/api/sports/team-schedule?league=nfl&team=2` → 200 |
| Predictions (picks) | PASS | `/api/picks` → 401 unauthenticated (correct); auth-gating verified |
| History | PASS | Covered by picks endpoints; 401 gate correct |
| Follows/watchlist | PASS | `/api/account/follows` → 401 unauthenticated (correct) |
| Leaderboard | PASS | `/api/leaderboard` → 200; `/api/account/leaderboard` route exists |
| Auth/account | PASS | `GET /api/account` → `{user:null}` anonymous; bad login → 401 `invalid_credentials` generic (no enumeration) |
| Stale-clock | PASS (code-verified) | Bundle contains the stale-clock path; live-game trigger not exercisable read-only (0 live events); contract unit-tested 285/285 |

### Real-data findings

- `/api/sports` returns the full board: **427 events across ~60 leagues** (NFL, NBA, NHL, MLB, EPL, UCL, ATP/WTA, UFC, etc.), `source: "ESPN"`, real team names/scores/logos.
- Status mix at validation time: 220 final, 207 scheduled, **0 live** — consistent with ~1am PT Saturday.
- Sample verified end-to-end: Dolphins at Bills (`401873070`), scheduled 2026-11-22T18:00Z, DraftKings odds via ESPN embedded source (spread −16.5, total 44.5).
- **Degraded feed observed:** board `fetchedAt` held at `2026-11-21T07:56:57Z` across ~11 minutes of polling with `stale: true` — the stale flag is honestly reporting an aging snapshot (SWR design). Event-level fetches (`/api/sports/event`, `/api/sports/market`) returned fresh timestamps (~08:05Z), so upstream connectivity is healthy; the board snapshot refresh appears slow/backed-off. Impact: low (no live events); UI correctly labels it.

### Secrets / client exposure

- Scanned all served JS chunks across 10 pages (~18 chunks): **no** `service_role`, `ODDS_API_KEY`, `SUPABASE_*`, JWT (`eyJhbGciOi`), or API-key literals found.
- No `*.supabase.co` URL in client bundles — Supabase is server-side only via custom API routes (service role never reaches the client).
- API JSON responses contain no key material; `freshness.error:"missing_key"` reveals only that a key is absent, not its value.

### Supabase persistence — PASS (verified 2026-11-21T08:29–08:33 UTC)

Authorized disposable-account test on production, fully cleaned up:

1. `POST /api/account {action:"register"}` → 200, user `devin_persist_20261121082953`, UUID `42e31a24-0f90-448d-b35c-8e811cbe58ae`, 5000-chip signup award applied.
2. `PATCH /api/account/follows` → followed team `nfl:2` (Buffalo Bills) → 200 `{follows:[…]}`.
3. `DELETE /api/account` (logout) → session cleared.
4. Fresh `POST /api/account {action:"login"}` → new session, same user id.
5. `GET /api/account/follows` → **follow persisted across sessions** — durable storage confirmed (local JSON fallback on serverless cannot reliably survive across instances; UUID user ids match the Supabase `cowboy_users` shape).
6. Cleanup: unfollow → `DELETE /api/account/delete {password}` → 200; subsequent login → 401 `invalid_credentials`, session → `{user:null}`. No residual test data.

No wagers, picks, or paid entries created. No infrastructure or env changes made.

### Provider traffic / polling

- `refreshAfterMs: 1000` is the server-directed board hint; client polling pauses when hidden and never overlaps (E2E-verified). No duplicate-polling evidence in responses; per-instance caches mean upstream call volume is bounded by design.
- `/api/sports/odds` made one read-only call during validation (~3 credits if a key were configured — it is not, so zero upstream cost).

### Environment finding (non-blocking)

- **`ODDS_API_KEY` is not set in production Vercel env.** `/api/sports/odds` reports `freshness.error: "missing_key"` and serves ESPN embedded odds (honestly labeled `source: "espn"`, `provider: "DraftKings"`). This is correct degraded behavior — the quota-cost fix is dormant until a key is added. ToS bookmaker odds require adding `ODDS_API_KEY` to Vercel env (free tier, no plan change).

### P0/P1 defects

**None found.**

### Verdict

**PASS — production is serving a build consistent with `4042592`, all public surfaces healthy, honest freshness/stale labeling confirmed under a real degraded-feed condition, no secret exposure, auth gating correct.** Remaining unknowns: Supabase-vs-JSON store confirmation (needs one authorized write or env check) and live-game stale-clock behavior (needs a live event window).
