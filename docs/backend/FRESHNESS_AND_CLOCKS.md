# Freshness & Clock Contract

## Sources of truth

| Field | Meaning |
|---|---|
| `LiveBoard.fetchedAt` | When the server assembled this board payload |
| `LiveBoard.stale` | Board-level staleness flag |
| `leagues[].lastSuccessAt` / `scoresUpdatedAt` / `status` | Per-league provider health |
| `leagues[].backupSource` | Set when scores come from a fallback feed (NHL/MLB/Livescore/OpenLigaDB/SportsDB) — **display-only, never pickable/settleable** (`PickService.fetchEvent` rejects `scoreSource` events) |
| `LiveEvent.scoreSource` | Which feed produced this event's score |
| `HybridOddsResult.freshness` | Odds-specific freshness (see API_CONTRACTS) |
| `deriveLiveState()` | Per-event canonical state + clock (`app/lib/live-state.ts`) |

## Canonical live states

`scheduled | pregame | live | halftime | intermission | delayed | postponed | suspended | final | cancelled | unknown`

Derived by `deriveLiveState(event, { fetchedAt, now, staleAfterMs })`:
- `scheduled` → `pregame` when start is within 30 min.
- `live` → refined by provider `statusText` (Halftime/Delayed/Postponed/Suspended); otherwise `live`.
- Clock `state`: `running` only for `live`; `stopped` for halftime/final/delayed/postponed/suspended; `unknown` otherwise. **The server never fabricates clock movement** — `clock.value` is the provider's display string verbatim.

## Freshness semantics

- `clock.ageMs` = `now - fetchedAt`; `clock.stale` = `ageMs > staleAfterMs` (default 30s for live).
- A frozen provider clock returning HTTP 200 is indistinguishable at the status level — clients MUST check `clock.stale`/`ageMs` before rendering "live" indicators.
- `fetchedAt: null` → `ageMs: null`, `stale: false` — unknown freshness is not assumed fresh OR stale; render as unknown.
- Odds freshness states: `fresh | delayed | expired | unavailable` with `cache: hit|miss|stale` and `error` category. `unavailable` must never render as live odds.

## Refresh cadence (server)

Live scores ~1.5s, schedules ~8s, retries ~5s, per-league pacing 70–700ms, ESPN 429 backoff honored. Client should follow `refreshAfterMs` and revalidate on visibility change.
