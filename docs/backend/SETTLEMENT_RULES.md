# Settlement Rules

Free-play settlement only — no money, no payouts in currency. Chips settle in chips (no cash value).

## When settlement runs

`POST /api/picks/refresh` and `POST /api/parlay/refresh` (also triggered by board polling in the UI). Settlement is pull-based: open tickets are re-fetched against the provider until final.

## Preconditions (all must hold)

1. `event.status === 'final' && event.completed === true` (or `'cancelled'` → void).
2. `event.id === ticket.eventId && event.league === ticket.league`.
3. `event.home.id === ticket.homeId && event.away.id === ticket.awayId` — identity re-verified every refresh; a provider id reuse or wrong-game feed cannot grade a pick.
4. `event.scoreSource` must be absent — backup/display-only feeds never settle.

## Result mapping

| Market | Win condition | Push/void |
|---|---|---|
| moneyline | `ticket.side === event.winner` | n/a (winner always decisive) |
| spread | `margin + line > 0` for chosen side | `=== 0` → void |
| total | over: `sum - line > 0`; under: `line - sum > 0` | `=== 0` → void |
| prop | graded stat vs line via final box score (`getPlayerPropValue`) | missing stat → void (never guesses) |
| parlay | all legs won → won; any lost → lost; any void → void | — |

## Edge cases

- **Postponed/cancelled** → `void`, full chip refund.
- **Corrected results**: settlement only reads `final`; a later correction that flips `winner` does NOT re-grade already-settled tickets (documented limitation — ESPN corrections post-final are rare; revisit if observed).
- **Unresolved**: stays `open` until final data arrives; props with unresolvable stats → `void`.
- **Double-settlement**: impossible — `settlePicks`/`settleParlays` only transition `open` rows; chip credits use unique `awardKey`s (`pick_win:{id}`, `chip_result:{id}`, `chip_refund:{id}`) so retries are no-ops.
- **Provenance**: `settledAt` timestamp + the verified event identity are the evidence trail; `changes[]` on tickets records pre-lock edits.

## Chip settlement (no cash)

- Won: `stake × decimal(odds)` chips credited (`chip_win`).
- Void/cancelled: full `stake` refunded (`chip_refund`).
- Lost: stake forfeit. Free picks (no stake) settle identically minus chips.
