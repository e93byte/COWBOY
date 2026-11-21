# Corrected-Result Regrading — Design (not yet enabled)

## Problem

`PickService.refresh` settles on the first authoritative `final` it sees. If a provider later corrects the official result (rare but real — stat corrections, eligible-player rulings), settled picks are not re-graded. Documented limitation.

## Design

### Data model (additive, no destructive migration)

New table/collection `cowboy_settlement_corrections` (Supabase) / `settlementCorrections[]` (local store):

```ts
{
  id: uuid,
  ticketId: string,               // or parlayId
  userId: string,
  eventKey: string,               // league:eventId — provenance anchor
  originalStatus: 'won'|'lost'|'void',
  correctedStatus: 'won'|'lost'|'void',
  originalSettledAt: string,
  correctedAt: string,
  evidence: {                     // what changed and why
    winnerBefore: string|null, winnerAfter: string|null,
    homeScoreBefore: number|null, awayScoreBefore: number|null,
    homeScoreAfter: number|null, awayScoreAfter: number|null,
    provider: string, sourceAt: string,
  },
  chipDelta: number,              // signed chip adjustment already applied
  rolledBack: boolean,
}
```

The original ticket row keeps `status`/`settledAt` **plus** a new optional `regradedFrom` pointer — original settlement record is preserved, never overwritten silently.

### Flow

1. **Detection**: a scheduled reconciliation job (or manual admin trigger) re-fetches `final` events that had settlements in the last N days and diffs `winner`/scores against stored evidence.
2. **Gate**: only re-grade when the provider's *new* final disagrees with the stored settlement evidence AND the event identity still verifies (`homeId`/`awayId` unchanged). Identity mismatch → alert, never re-grade.
3. **Apply**: inside one store transaction — write correction record, update ticket status/settledAt, compute `chipDelta = correctPayout - originalPayout`, apply via `adjustTokens` with `awardKey = regrade:{ticketId}:{correctedAtEpoch}` (idempotent).
4. **Audit**: before/after state lives in the correction record; `rolledBack` supports reversal.
5. **Rollback**: a `rollback` action re-applies the inverse chip delta with a new awardKey and marks the correction `rolledBack: true` — never deletes history.

### Safety rules

- Re-grading is **manual/admin-triggered**, never automatic on refresh — prevents flip-flopping on provider glitches.
- Only `won ↔ lost ↔ void` transitions; `cancelled` tickets are terminal.
- Chip adjustments are signed deltas, so a re-grade that *reduces* a payout claws back chips but never drives balance negative (clamp at 0 + flag for review).
- Points/token awards (`pick_win`) use the same awardKey pattern; a corrected win→loss emits a compensating `pick_regrade` ledger entry rather than editing history.

### Tests required before enabling

- correction won→lost with chip clawback
- correction void→won payout
- idempotent regrade retry (same awardKey → no double delta)
- rollback restores original status + chips
- identity-mismatch correction rejected
- concurrent regrade attempts serialize

## Status

**Design only.** No schema changes made. Requires review before the migration is written.
