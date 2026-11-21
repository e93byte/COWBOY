# Prediction Model

Free-play picks only. No money, no wagering, chips have no cash value.

## Ticket (`RealPickTicket` / `StoredPick`)

```ts
{
  id: uuid, eventId: espnId, league, eventName,
  selection: string,             // display name of the pick
  side: 'home'|'away'|'draw'|'over'|'under',
  market?: 'moneyline'|'spread'|'total'|'prop',   // default moneyline
  line?: number | null,          // spread (signed, home-perspective at post),
                                 // total, or prop line
  prop?: { player, stat, book, line },
  live?: boolean,                // submitted while event in-progress; final at submit
  odds?: number | null,          // American odds at post time (needed for chip payout)
  startsAt, createdAt,
  status: 'open'|'won'|'lost'|'void'|'cancelled',
  settledAt: string | null,
  changes?: { side, selection, changedAt }[],    // edit audit trail
  entryId?, entryIndex?, entrySize?,             // multi-pick batch (2–5)
  chipStake?: number,            // escrowed chips; 0/absent = free pick
  requestId,                     // client idempotency key (8–128 chars)
  homeId, awayId,                // settlement verification anchors
}
```

## Parlay (`StoredParlay`)

`{ id, legs: ParlayLeg[], entryId, combinedOdds, chipStake?, status, settledAt, createdAt }` — legs are pick references; same-game correlation flagged, not priced.

## Lifecycle rules

- **Submit**: scheduled (before start) or live events only; verified participants; one pick per game+market; prop lines must match a currently posted prop.
- **Edit/cancel**: scheduled picks only, before `startsAt`; live picks are final at submission. Edits carry `revision` (optimistic concurrency).
- **Settlement** (`PickService.refresh`, `parlay-service`): waits for `status==='final' && completed===true`; re-verifies event identity; prop picks grade from final box score via `getPlayerPropValue`/`gradePropValue`.
- **Void**: cancelled/postponed events, pushes (differential === 0), unresolvable props → `void` + chip refund.
- **Idempotency**: `awardKey` (`pick_win:{id}`, `chip_result:{id}`, `chip_refund:{id}`) makes settlement and refunds replay-safe; chip balance can never go negative.
- **No double-settlement**: `settlePicks` only transitions `open` tickets; settled tickets are never re-graded.
