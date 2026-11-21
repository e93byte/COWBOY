# Release Readiness Report

**Baseline commit:** `5a7d39d` (+ this report's commit)
**Verdict: READY WITH KNOWN LIMITATIONS**

Backend gates are green. Full READY requires integrated Codex-preview evidence — Codex's UI batch is still uncommitted (~30 files in flight), so contract integration is verified by contract review + unit/integration tests, not a deployed preview.

## Status

| Gate | Status | Evidence |
|---|---|---|
| Unit/integration tests | ✅ 274/274 | incl. 21 identity/live-state, 17 hybrid-odds, 6 settlement edge cases |
| Typecheck | ✅ clean | `tsc --noEmit` |
| Production build | ✅ clean | `next build` |
| Persistence | ✅ durable | Supabase prod (11 migrations) + validated JSON fallback |
| Auth | ✅ hardened | scrypt, hashed sessions, SameSite=Strict+Secure, same-origin CSRF, MutationLimiter, 4KB bodies |
| Settlement | ✅ deterministic | final+completed gate, identity re-verify, idempotent awardKeys, void/push rules |
| Event identity | ✅ | canonical ESPN id; provider matching rejects ambiguity (stress-tested) |
| Clock/freshness | ✅ | `deriveLiveState` contract; stale detection without fabrication |
| Security | ✅ no P0/P1 | RLS locked (service-role RPCs only), no client secrets, generic errors |

## Backend contract changes this cycle

- `hybrid-odds.ts`: primary path now identity-matches ToS boards to the canonical ESPN event (was unreachable — opaque id compare). Additive `freshness` unchanged.
- New modules: `event-identity.ts`, `live-state.ts` — additive, no breaking changes.
- New tests: `settlement-edge-cases.test.ts` (6), identity/live-state stress cases (+8).

## Codex integration status

Contract docs delivered: `docs/backend/{API_CONTRACTS,EVENT_MODEL,PREDICTION_MODEL,AUTH_PERSISTENCE,FRESHNESS_AND_CLOCKS,SETTLEMENT_RULES,REGRADING_DESIGN,CROSS_INSTANCE_RISK,NOTIFICATIONS}.md`.
Codex should consume `freshness.state`/`clock.stale`/`ageMs` for honest live UI. No contract mismatches found in reviewed routes. **Pending:** verification against Codex's actual preview build.

## Kilo QA status

Independent verification areas assigned: identity ambiguity rejection, stale-clock detection, quota header behavior, settlement retry idempotency. No defects reported yet.

## Known limitations

1. **Corrected results** — settled picks are not re-graded (design in `REGRADING_DESIGN.md`, not enabled).
2. **Per-instance state** — MutationLimiter, odds cache/quota are per-serverless-instance (risk quantified in `CROSS_INSTANCE_RISK.md`; Supabase-table option identified, no infra provisioned).
3. **Push notifications** — event contract defined (`NOTIFICATIONS.md`), no provider provisioned (needs approval).
4. **Live/in-play market depth** — constrained by free provider coverage; honestly labeled.

## Security blockers

None. P2 only: per-instance rate limiting (above).

## Data-provider blockers

The Odds API daily cap is self-imposed; plan upgrades are a spend decision. ESPN embedded odds are unofficial pick-center data — labeled fallback only.

## Infrastructure blockers

None required for release. Redis/KV optional at scale.

## Rollback

1. Revert to `5a7d39d` (or earlier green commit) and push — Vercel auto-deploys.
2. Supabase migrations are additive-only; no rollback needed unless a migration itself is faulty (none are — all applied and verified).
3. Feature flags: none currently; odds freshness fields are additive and ignored safely by older clients.

## To reach READY

- Codex preview branch → run contract-integration pass (§2 of mission).
- Kilo defect reports → reproduce, patch backend-owned code, regression test.
