# Hybrid Odds — Cache & Provider Hardening

Commit: `450d952` · Files: `app/lib/hybrid-odds.ts`, `app/api/sports/odds/route.ts`, `tests/hybrid-odds.test.ts`

## Implementation matrix

| Requirement | Status | Where |
|---|---|---|
| Testable client factory | ✅ | `createHybridOddsClient({ fetch, now, env, ttl, getEvent })` |
| Canonical cache keys | ✅ | `toa|sportKey|regions|markets|oddsFormat` — full request signature, never `league:id` |
| Success cache + TTL by data type | ✅ | 60s live boards, 5m pregame (env-overridable per client) |
| Single-flight dedup | ✅ | `pending` map keyed identically to cache |
| Bounded eviction | ✅ | 500-entry FIFO cap |
| Quota manager | ✅ | `createQuotaTracker` — `x-requests-remaining/used/last`, daily cap (`ODDS_API_DAILY_CREDITS`, default 400), Retry-After backoff, exhausts until next UTC day |
| Freshness metadata | ✅ | `freshness: { state, provider, sourceAt, fetchedAt, cache, error }` — additive on result + API response |
| Error categories | ✅ | `missing_key, quota_exhausted, unauthorized, rate_limited, region_unavailable, network, empty_market, malformed, no_provider` |
| Capability registry | ✅ | `PROVIDER_CAPABILITIES` — only `bookmaker-odds` providers enter the odds chain; score feeds excluded |
| Route contract preserved | ✅ | `eventId, league, name, startsAt, status, odds, oddsBooks, provider, source` unchanged; `freshness` added |
| Server-side key only | ✅ | `ODDS_API_KEY` read in factory env, never serialized |

## Cache architecture

The Odds API returns **every event for a sport** per call, so the cache stores the whole board per `sportKey+regions+markets+format` — one upstream call now serves all event lookups for that sport until TTL expiry. This is the primary quota saver: N event views → 1 upstream request per TTL window per instance.

```
fetchOddsWithFallback(league, id)
  → toOddsApiKey(league)            // unmapped leagues never call upstream
  → fetchSportBoard(sportKey)
      cache hit (fresh)  → return payload
      pending hit        → await same promise (single-flight)
      miss               → quota.allow() && breaker.allow()
                          → GET /v4/sports/{key}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american
                          → quota.observe(headers)  // authoritative usage
                          → categorize status → cache success | return error
  → match event by id (exact only — no events[0] fallback)
  → mapOddsApiEventToOddsBooks (up to 8 books, h2h/spreads/totals)
  → miss/error → ESPN fallback (bookmaker-odds capability only)
```

## Provider capability matrix

| Provider | bookmaker-odds | scores/schedules | prediction-market | props |
|---|---|---|---|---|
| The Odds API | ✅ primary | — | — | — |
| ESPN (embedded pick-center) | ✅ fallback | ✅ | — | ✅ |
| Kalshi | — (labeled exchange) | — | ✅ separate surface | — |

Score/schedule providers are structurally excluded: `fetchSportBoard` only knows The Odds API, and the fallback calls `getLiveEvent` (ESPN detail) which carries bookmaker-odds capability. Nothing in `provider-fallbacks.ts` was added to the odds chain.

## Quota policy

- **Budget**: `ODDS_API_DAILY_CREDITS` env (default 400/day per instance). `allow()` refuses upstream calls once `used >= cap`.
- **Provider truth**: response headers `x-requests-remaining/used/last` override local counting; `remaining <= 0` parks upstream until next UTC midnight.
- **Rate limit**: 429 → `rate_limited` + `noteRetryAfter(seconds)` idles calls for the hinted duration; circuit breaker (3 failures / 60s cooldown) adds failure backoff.
- **Never** enables paid plans or auto-purchases.

## Test evidence

`tests/hybrid-odds.test.ts`: **17 tests, all passing** — cache hit/miss, single-flight dedup, TTL expiry, sport isolation, missing key, 401/403, 429+Retry-After, 451, quota depletion + next-day recovery, header-authoritative usage, valid empty market, malformed payload, network failure, unmapped league, breaker recovery, freshness-never-fresh-on-unavailable.

Suite totals: **247/247 unit tests**, `tsc --noEmit` clean, `next build` clean.

Reduced upstream calls (by construction): repeated lookups for events in the same sport+market board within TTL → **1 upstream call** instead of N (verified by `calls === 1` assertions in cache/dedup tests).

## Serverless limitations

Cache, pending map, quota tracker, and breaker are **per Vercel instance** — cold starts reset them, and N concurrent instances can each spend up to the daily cap. Acceptable at current scale; Redis/KV is out of scope unless provisioned. Clients must honor `freshness.state` — a `delayed`/`expired`/`unavailable` result must never render as live.

## Unresolved licensing blockers

- The Odds API usage is governed by its own plan terms; the daily cap is a self-imposed guard, not a license guarantee.
- ESPN embedded odds are unofficial pick-center prices — fine as a labeled fallback, not a redistribution license.
- Kalshi prices remain prediction-market probabilities, not bookmaker lines.
