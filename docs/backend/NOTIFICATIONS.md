# Notification Event Contract (provider-agnostic)

Backend emits domain events; delivery is a separate, pluggable concern. No push provider provisioned.

## Event types

```ts
type NotificationEvent =
  | { kind: 'game_starting_soon'; league: string; eventId: string; startsAt: string; title: string }
  | { kind: 'game_live';        league: string; eventId: string; title: string }
  | { kind: 'score_change';     league: string; eventId: string; title: string; homeScore: number; awayScore: number }
  | { kind: 'game_final';       league: string; eventId: string; title: string; winner: 'home'|'away'|'draw'|null }
  | { kind: 'prediction_settled'; ticketId: string; status: 'won'|'lost'|'void'|'cancelled'; title: string }
  | { kind: 'followed_team_game'; league: string; eventId: string; title: string; team: string }
  | { kind: 'provider_degraded'; league: string; detail: string };  // rare, user-facing only
```

## Deduplication rules

- `game_starting_soon`: once per event per user, keyed `(userId, eventId, 'start')`, only within T-10min of `startsAt`.
- `game_live`: once per event per user, keyed `(userId, eventId, 'live')`, on first `status → live` transition only.
- `score_change`: coalesced — max 1 per event per user per 5 min; suppressed for users not following/picked.
- `game_final`: once per event per user.
- `prediction_settled`: once per ticket, keyed `(userId, ticketId)` — settlement is already idempotent via awardKeys.
- `provider_degraded`: at most 1 per league per 30 min, only when `leagues[].status === 'error'` persists.

## Delivery guarantees (target, when a provider is chosen)

- At-least-once emission with client-side dedup by the keys above.
- Preferences stored per user (Codex UI owns the surface): per-kind opt-in, quiet hours, per-league mute.
- No notification for events the user has no relationship to (not picked, not following, not leaderboard-relevant).
- Provider interface: `send(user, event) → { delivered: boolean }`; implementations for web-push/email/SMS slot in without contract changes.

## Explicit non-goals

- No marketing/promotional notifications.
- No notifications for odds movements (too noisy) unless a user explicitly opts into a specific game.
- No fabricated urgency ("act now" dark patterns).
