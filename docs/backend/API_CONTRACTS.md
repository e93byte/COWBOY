# Canonical API Contracts

Every screen MUST consume these shapes. Do not invent per-screen event models.
All JSON responses use `Cache-Control: no-store` unless noted. Errors are `{ error: string, message?: string, source?: string }` with 4xx/5xx status.

## Sports data

### `GET /api/sports?league=<id>` → `LiveBoard`
```ts
{
  events: LiveEvent[];          // canonical event shape — see EVENT_MODEL.md
  golf?: GolfTournament[];
  leagues: { id, sport, name, status: 'ok'|'stale'|'error',
             lastSuccessAt?, scoresUpdatedAt?, backupSource?, error? }[];
  fetchedAt: string;            // board fetch time — use for freshness UI
  source: 'ESPN';
  refreshAfterMs: number;       // client poll hint (1500 live / 8000 sched)
  stale: boolean;
}
```

### `GET /api/sports/event?league=<id>&id=<espnEventId>` → `LiveEvent`
Single event detail. Falls back to scoreboard normalization with `{ ...event, stale: true, fallback: 'scoreboard' }`. 404 `{ error }` when unknown.

### `GET /api/sports/odds?league=<id>&id=<espnEventId>` → `HybridOddsResult`
```ts
{
  eventId, league, name, startsAt, status,
  odds: GameOdds | null,        // primary book
  oddsBooks: GameOdds[],        // all books (ESPN pick-center or ToS multi-book)
  provider, source: 'the-odds-api'|'espn'|null,
  freshness: {                  // ADDITIVE — consume for stale/unavailable UI
    state: 'fresh'|'delayed'|'expired'|'unavailable',
    provider, sourceAt, fetchedAt,
    cache: 'hit'|'miss'|'stale',
    error: 'missing_key'|'quota_exhausted'|'unauthorized'|'rate_limited'
         | 'region_unavailable'|'network'|'empty_market'|'malformed'|'no_provider'|null,
  },
}
```

### `GET /api/sports/props?league&=<id>&id=<id>` → `{ props: PlayerPropFeed | null }`
`props: null` is a valid "no props posted" answer, not an error.

### `GET /api/sports/futures?league=<id>` → `{ futures: FuturesMarket[] | null }`

### `GET /api/sports/market?league&=<id>&id=<id>` → market-reference data (outright context).

### `GET /api/sports/news?league=<id>` → `{ articles: [...] }` (league news feed).

### `GET /api/sports/team-schedule?...` → team schedule rows.

## Account & picks

All under `/api/account`, `/api/picks`, `/api/parlay`, `/api/contests`, `/api/leaderboard`. Session is the `cowboy_session` HttpOnly cookie (SameSite=Strict, Secure in prod). Mutating routes require same-origin `Origin` header and are rate-limited.

- `POST /api/account` `{action:'register'|'login', username, password}` → `{ user }` + Set-Cookie. New users get **5,000 chips**.
- `GET /api/account` → `{ user }` (null when logged out). `DELETE` logs out.
- `POST /api/picks` submit single; `POST /api/picks/batch` 2–5 picks (one per game+market, distinct requestIds). Pick input: `{ eventId, league, side, requestId, market, line, prop?, chipStake? }`.
- `GET /api/picks` → `RealPickTicket[]`. `PATCH` edit/cancel with `{id, action, side, revision, line?}`. `POST /api/picks/refresh` → re-fetches open tickets and settles.
- `POST /api/parlay` + `GET /api/parlay` — parlay tickets `{ legs, combinedOdds, chipStake?, status }`; `POST /api/parlay/refresh` settles.
- `GET/PUT /api/account/follows` — favorite teams/leagues/players (`FollowPreference[]`).
- `GET /api/picks/consensus` — anonymous aggregate pick percentages (no identities).
- `GET /api/leaderboard`, `/api/account/leaderboard`, `/api/contests*` — opt-in public standings.

## Rules for Codex

1. Render `freshness.state !== 'fresh'` as delayed/unavailable — never as live.
2. `props: null`, `futures: null`, `odds: null` are valid empty states.
3. Pick `status` ∈ `open|won|lost|void|cancelled`; `void` = push/postponed/cancelled (stake refunded).
4. Chips have no cash value — never render them as currency.
