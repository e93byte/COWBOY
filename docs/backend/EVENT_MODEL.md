# Event Model & Identity

## Canonical identity

The canonical event is the **ESPN scoreboard event**:

```
canonicalId = LiveEvent.id            // ESPN id, e.g. "401" or "401-67890"
key         = `${league}:${id}`       // e.g. "nfl:401"
```

Provider namespaces (see `app/lib/event-identity.ts`):

| Provider | Ref shape | Resolution |
|---|---|---|
| ESPN | `espn:{id}` | exact id match |
| The Odds API | `toa:{sportKey}:{opaqueId}` | team names + commence_time within 72h, BOTH sides unambiguous |
| Kalshi | `kalshi:{series}:{eventTickerSuffix}` | team-name coverage + 72h window (exchange-odds.ts) |
| Internal picks | `league + eventId + homeId + awayId` | verified on every refresh/settle |

## Matching rules (enforced)

- `teamNameCovers(needle, haystack)`: every token of the shorter name must appear in the longer ("Chiefs" ⊂ "Kansas City Chiefs").
- `matchProviderEvent` returns `null` on **any** ambiguity: two candidates, missing side, or mismatched teams. Null = no association — never guess.
- Settlement additionally requires `event.home.id === stored.homeId && event.away.id === stored.awayId` — wrong-game odds can never grade a pick.

## Dedup

- Scoreboard events are unique per `league:id`.
- Provider boards are matched 1:1 to canonical events; unmatched provider rows are ignored (no duplicates created).
- Pick store enforces uniqueness on `(userId, league, eventId, market)` and `(userId, requestId)` — DB constraints + store validation.

## Team/player identity

Teams carry ESPN `id` + `name` + `shortName`. Players carry ESPN athlete `id`. Provider name variants resolve only through `teamNameCovers`; conflicting names never merge.
