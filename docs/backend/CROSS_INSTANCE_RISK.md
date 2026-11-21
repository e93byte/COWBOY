# Cross-Instance Reliability — Risk Assessment (no infra changes)

## Affected components

| Component | Scope | Failure mode |
|---|---|---|
| `MutationLimiter` | auth mutations, 10/15min per username + 60/15min global | N serverless instances → effective limit ×N. Brute-force window widens linearly with instance count. |
| Hybrid-odds cache/quota/breaker | ToS board cache, daily credit cap, 429 backoff | Each instance caches independently → up to N× upstream calls per TTL; each instance enforces its own daily cap → total spend up to N× configured cap. |
| Exchange-odds cache | Kalshi league feeds, 60s TTL | N× upstream calls; harmless (free API, no quota). |
| AccountStore file backend | local/dev only | Not used in production (SupabaseStore). N/A. |

## Quantified risk at current scale

- Vercel serverless typically runs **1–10 warm instances** for this traffic level.
- Worst case: 10 instances × 400 daily ToS credits = **4,000 credits/day** vs the 400 intended — still under The Odds API free tier (500/mo is the real constraint; the daily cap is self-imposed headroom, not a license limit).
- Auth throttling: 10 instances → 100 attempts/15min per username instead of 10. Meaningful but not catastrophic; scrypt cost (~100ms/hash) is the real brute-force brake.

## Failure modes documented

1. **Quota overspend**: bounded by instance count × daily cap; auto-recovers at UTC midnight; never purchases plans.
2. **Cache stampede**: single-flight is per-instance; a cold-start thundering herd can fire N parallel upstream calls — bounded by breaker + quota.
3. **Rate-limit bypass**: attacker rotating requests across instances gets N× the mutation budget.

## Lowest-cost shared-state options (when needed)

1. **Vercel KV / Upstash Redis** (~$0 at low volume): shared `MutationLimiter` buckets + odds quota counter + optional board cache. Single env var, standard fetch API.
2. **Supabase-backed counters**: already provisioned — a `cowboy_rate_limits` table with RPC increment. Zero new infra, higher latency.
3. **Keep per-instance + tighten limits**: reduce `ODDS_API_DAILY_CREDITS` and mutation limits by expected instance count — free, approximate.

## Recommendation

**Do not provision yet.** Revisit when either: (a) instance count regularly exceeds ~10, (b) The Odds API plan is upgraded and quota precision matters, or (c) abuse is observed. The Supabase-table option is the cheapest correct step when that day comes — no new vendor needed.
