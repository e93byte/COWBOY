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
