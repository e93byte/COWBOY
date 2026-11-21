# Codex Integration Report

**Verified against:** working tree containing Codex's uncommitted UI batch (~28 files) + backend `8ef1a79`.
**Codex commit:** pending — verification ran on the working tree; re-run on their commit for the formal gate.
**Evidence:** 284/284 unit · 81/81 Playwright · typecheck clean · `next build` clean.

## Surface verdicts

| Surface | Verdict | Evidence |
|---|---|---|
| Home | **PASS** | `SportsGlance` consumes `board.fetchedAt`/`stale` honestly ("Last received" when delayed); community pick, personalization via `home-interests` |
| Live | **PASS** | Dedicated board filters in-progress only; polling honors `refreshAfterMs`, pauses hidden, never overlaps (E2E #53, #78, #79) |
| Scores | **PASS** | `scoreSource`/`backupSource` guards — backup feeds labeled, never pickable/settleable (E2E #44, #80); score corrections get distinct cues |
| Game Center | **PASS** | Event identity stable `league:id`; odds board merges ESPN pick-center + Kalshi exchange book; lineups/standings/drives/box score all provider-sourced |
| Odds / freshness | **PASS (note)** | Codex consumes `event.odds`/`oddsBooks` embedded in `LiveEvent`. **No client calls `/api/sports/odds` yet** — the `freshness.{state,sourceAt,fetchedAt,cache}` contract is additive/unused, zero mismatch |
| Props | **PASS** | `/api/sports/props` contract `{ props \| null }` stable; prop picks validate against posted lines server-side |
| Futures | **PASS** | `/api/sports/futures` + `LeagueFutures`; futures not pickable (correct — outright context only) |
| Predictions | **PASS** | Submit/batch/edit/cancel/refresh all E2E-verified (#45, #58, #62, #63); settlement states `open/won/lost/void/cancelled` consumed correctly; chips shown as chips |
| Pick history | **PASS** | `history-filters.spec.ts` — record filters, date sorting, custom ranges all pass |
| Follows / watchlist | **PASS** | E2E #46, #47, #71 — reversible, persistent, owner-isolated; keyboard team discovery works |
| Leaderboard | **PASS** | Opt-in public standings (E2E #19); anonymous consensus is aggregate-only |
| Auth / account | **PASS** | Register→draft→submit→settle E2E (#58); session cookie flow, delete-with-password (#13), cross-origin rejection unit-tested |

## Contract-consumption audit

| Contract element | Consumed? | Notes |
|---|---|---|
| `freshness.state` (odds route) | ❌ unused | No `/api/sports/odds` client exists yet — additive, safe |
| `freshness.sourceAt` / `fetchedAt` / `cache` | ❌ unused | Same — ready when a client adopts the route |
| Canonical live state (`deriveLiveState`) | ⚠️ parallel impl | Codex built `event-presentation.ts` freshness (`current/backup-current/delayed/unavailable`) from league status + timestamps — honest, no invented truth, but **per-event `clock.stale`/`ageMs` is not consumed** |
| `clock` / `period` / `statusText` | ✅ verbatim | Rendered as provider strings; no client-side clock fabrication |
| Prediction settlement states | ✅ | All five states handled; void/cancelled semantics correct |
| Event identity Home→Game Center→odds→picks | ✅ | `league:id` + `homeId`/`awayId` verification consistent end-to-end |

## Upstream-request audit

- Polling is single-flight client-side (abort + `running` guard), honors `refreshAfterMs`, pauses on `document.hidden` — **no duplicate upstream requests introduced**.
- `/api/sports/odds` has zero callers → hybrid-odds cache/quota cannot be bypassed or stampedes; when adopted, the per-sport board cache already dedupes.
- Game Center event fetch is on-demand per open dialog — bounded.

## Security / ownership regression

- No P0/P1 found. Auth, CSRF, ownership scoping, settlement verification all still enforced (284 unit incl. all adversarial cases).
- Codex UI introduces no new mutation surfaces bypassing `assertSameOrigin`/`MutationLimiter`.

## Observations (non-blocking)

1. **Per-event clock staleness**: a frozen provider clock on HTTP 200 shows `status:'live'` indefinitely; Codex's league-level freshness will mark the *league* delayed but the event badge may still read live. `deriveLiveState` is available — recommend adoption when convenient, not a release blocker.
2. **`/api/sports/odds` unused**: the hardened route (freshness, quota, identity matching) currently serves nothing. Either wire it into Game Center odds or accept it as dormant infrastructure.
3. **`event-presentation.ts` duplicates** part of `live-state.ts`'s job — fine for now; long-term consolidate to one canonical classifier to avoid divergent truth.

## Verdict

**PASS** — Codex's batch integrates cleanly with backend contracts. No contract mismatches, no invented client truth, no upstream amplification, no security regressions. Awaiting Codex's commit for the formal re-verification gate before `RELEASE_READINESS.md` is updated.
