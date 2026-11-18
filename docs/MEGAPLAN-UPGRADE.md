# COWBOY Megaplan — Competitive Upgrade Blueprint

> **Date:** 2026-11-18
> **Scope:** Audit of all scraped/reference assets on disk, feature-parity comparison
> against the top 6 sportsbook/picks platforms, and a phased plan to upgrade COWBOY.
> **Product boundary:** COWBOY remains a free-to-play predictions product. No real-money
> wagering, deposits, payouts, odds-as-prices, or sportsbook execution — see
> `docs/FEATURE-PLAN.md` for the compliance boundary this plan respects.

---

## 1. Asset inventory — what the scraped data actually contains

| Asset | Location | Size | Value to COWBOY |
|---|---|---|---|
| Multi-provider data router | `sites/sources-for cowboy/` | 26 MB | **Highest.** Production-grade TypeScript data layer: ESPN, MLB Stats API, NHL API, TheSportsDB, OpenLigaDB, API-Football, The Odds API, SportsDataIO, LiveScore, Matchbook, Kalshi, Polymarket, Smarkets, FanDuel (unofficial). Includes circuit breakers, stale-cache fallback, canonical league map, verified endpoint inventory with quotas/latency (`docs/ENDPOINTS.md`, probed 2026-11-18). |
| FanDuel website scrape | `sites/WEBSITE SCRAPES/Fanduel/` | ~4.9 GB (mostly CDN assets) | **High for UX.** Full page set: `picks/`, `free/`, `contests/`, `slates/`, `watch/` (live video), `player-news/`, `prediction-market-guide`, per-state sportsbook pages, Next.js manifests exposing route structure. |
| BetMGM website scrape | `sites/WEBSITE SCRAPES/BetMGM/` | ~116 MB | **Low.** Mostly CDN/tracker junk; `index.html` is a 7.6 KB JS shell. No usable page content — treat as reference only. |
| Browser captures (DK/FD) | `reference-captures/` | HTML + screenshots | **High for UX.** Real DOM captures of DraftKings/FanDuel home, live, game, NFL pages — use for layout/spacing forensics. |
| Fanatics alignment | `fanatics-alignment/` | images + store page text | **Medium.** App-store positioning, official marketing assets, community-tail concept evidence. |
| Top-6 UX forensic | `COWBOY-github/docs/TOP-6-UI-UX-EXAMINATION.md` | doc | Already-produced 6-phase design-token/micro-interaction blueprint — **largely implemented** (tokens, radar, glass shell exist in `app/live.css`). |
| Handoff docs | `CODEX-FULL-EXECUTION-HANDOFF.md`, `CODEX-HANDOFF-COMPETITIVE-PARITY.md` | docs | Prior planning context. |

### What `sources-for cowboy` gives that COWBOY doesn't use yet

COWBOY's `app/lib/live-sports.ts` is ESPN-primary with NHL/MLB score fallbacks and
LiveScore/OpenLigaDB soccer fallbacks (in progress, uncommitted). The source repo adds:

1. **Odds & implied probability** — ESPN per-event odds (DraftKings/Bet365,
   `open`/`close`/`current` for line movement), The Odds API (multi-book, props,
   historical), SportsDataIO line movement.
2. **Player props** — ESPN `propBets` endpoint (421 items for one NBA game, verified),
   API-Football player ratings, The Odds API player markets.
3. **Exchange/prediction-market consensus** — Matchbook (free, public prices),
   Kalshi, Polymarket, Smarkets → usable as a **crowd/market probability signal**
   without touching real money.
4. **Richer stats** — MLB `/feed/live`, NHL `right-rail` team stats, API-Football
   fixtures/statistics/events/lineups.
5. **More leagues** — canonical map covers `ncaab`, `ncaaf`, NPB, handball,
   volleyball, rugby via API-Sports family.
6. **Ops tooling** — `npm run probe` endpoint health matrix, per-provider attempt
   logs, quota headers (`x-requests-remaining`).

---

## 2. Current-state audit — what COWBOY already has

**Live board & data**
- 35 leagues across football, basketball, baseball, hockey, soccer, tennis, MMA, rugby, golf (`app/lib/sports-leagues.ts`).
- ESPN-primary scoreboard with per-league circuit breaker, bounded request queue (4 concurrent, 64 queue cap), 8 MB response cap, coalesced requests.
- Multi-tier fallback: ESPN → NHL/MLB official APIs → LiveScore/OpenLigaDB soccer → ESPN summary → last-known-good (5-min retention) with honest `stale`/`backupSource` labeling.
- Game Center: score progression, drives, plays, team stats, players, lineups (soccer), standings, injuries, schedule, golf leaderboard.
- Per-league source-health panel, freshness timestamps, offline scoreboard, PWA.

**Picks product**
- Free winner/draw picks, multi-pick slips (5-pick cap), open/live/settled filters,
  edit/cancel, grading (won/lost/void), accuracy, streaks, search/date/league filters,
  session persistence, responsible-play pause/self-exclusion, account sessions,
  follows, watchlist, export/delete account data.
- Deep links for games/sections; URL-addressable board filters.

**Design system**
- Obsidian/gold design tokens, frosted-glass header, live-radar pulse, tactile pick
  buttons, floating mobile nav — the TOP-6 Phase 1–6 work is substantially landed.

**Dead/unfinished code found — resolved**
- The unused fictional sportsbook prototype (`DemoWorkspace.tsx`, `PlayExtras.tsx`,
  `Predictions.tsx`, `app/lib/demo.ts`, and `tests/demo.test.ts`) was deleted.
  COWBOY now contains only the real free-picks product path; no simulated markets,
  virtual credits, cash-out formulas, or fictional sportsbook UI remain.
- Provider fallbacks and circuit-breaker work is committed as `bca8664`.
- BetMGM scrape yielded no usable content; don't plan around it.

---

## 3. Gap analysis vs the top 6

Rating: ✅ have · 🟡 partial · ❌ missing. Money-sportsbook features are mapped to
their **free-picks equivalent** — this is the professional way to compare without
crossing the compliance line.

| Capability | FanDuel | DraftKings | BetMGM | bet365 | Fanatics | Caesars | **COWBOY today** |
|---|---|---|---|---|---|---|---|
| Live scoreboard + clocks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Game center (stats/plays/lineups) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ strong |
| Free picks / predictions | ✅ Picks | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ core |
| Multi-leg slips | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (5-pick cap) |
| Pick history + grading | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Odds / implied probability display** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Market-implied win % / crowd %** | ✅ | ✅ | ✅ | ✅ | ✅ "14.2k fans" | ✅ | ❌ |
| **Line / probability movement** | ✅ | ✅ shimmer | ✅ | ✅ | 🟡 | ✅ boosts | ❌ |
| **Player props** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Same-game combo picks (SGP)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (multi-pick is cross-event only) |
| Contests / leaderboards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| News / editorial feed | ✅ player-news | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Live video / watch | ✅ | ✅ | ✅ | ✅ PiP | ✅ | ✅ | ❌ (licensing blocker) |
| Push notifications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (toast only) |
| Shareable pick cards | ✅ | ✅ | ✅ | ✅ | ✅ stories | ✅ | 🟡 link only |
| Search w/ autocomplete | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 basic |
| Personalization / watchlist | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Responsible play tools | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (free-pick scoped) |

**The pattern:** COWBOY matches or beats the top 6 on *data trust, resilience, and
pick lifecycle*. It loses on **context** — users can't see *why* a pick is
interesting (market %, line movement, props, public momentum) and can't *retain* the
loop (notifications, contests, news, shareable artifacts).

---

## 4. Upgrade tracks

### Track A — Data layer: port the router (highest leverage)

`sources-for cowboy` was built for exactly this app and probed live on 2026-11-18.
Do **not** copy-paste; port its provider adapters behind COWBOY's existing
`requestJson`/fallback architecture.

- **A1. Implied-probability signal (free, no key).** ESPN per-event odds endpoint
  (`/competitions/{id}/odds`) already returns DraftKings/Bet365 lines including
  `open`/`close`/`current`. Convert American odds → implied probability and render
  as "Market leans X%" on pick buttons — **display only, never a price, never
  stake-linked**. Add per-event fetch cap (default 8, as the source repo does) and
  cache per event.
- **A2. Prediction-market consensus.** Matchbook public prices + Kalshi markets are
  free. Compute a "public/pick consensus %" per game from COWBOY's own settled picks
  first (zero external dependency), then optionally blend market prices as a labeled
  secondary signal. This is the Fanatics "14.2k fans picking KC" equivalent.
- **A3. Line movement.** ESPN `open` vs `current` gives probability drift — power a
  subtle ▲/▼ indicator on picks (the DraftKings differentiator) without any paid feed.
- **A4. Player props (phase 2, needs key decision).** ESPN `propBets` works free but
  is unofficial; API-Football props need a key. Defer until A1–A3 prove the pattern.
- **A5. Provider-health matrix in CI.** Port `npm run probe` concept: fixture-based
  contract tests for healthy/partial/stale/malformed/HTML-wall/hanging responses —
  the WHOLE-NINE-YARDS Phase 2 gate.

### Track B — Retention loops

- **B1. Opt-in browser notifications** for followed games: start, score change,
  final. User-controlled categories, explicit permission UX, no silent notify.
  (WHOLE-NINE-YARDS pillar 7.)
- **B2. Contests.** Weekly free pick 'em contests with public leaderboards — FanDuel
  `contests/` and Fanatics community-tail prove demand; COWBOY has accuracy/streak
  math already. Keep it free, no entry fee, no prizes implying money.
- **B3. News/editorial feed.** FanDuel `player-news/` model: short generated or
  curated game previews attached to events. Cheapest version: auto-summary from
  existing summary-payload news fields ESPN already returns.
- **B4. Shareable pick cards.** Branded image card (canvas or styled DOM →
  `navigator.share`/clipboard) for "I picked X to win" — the Fanatics story-share
  equivalent. Pairs with existing deep links.

### Track C — Game Center depth

- **C1. Section-level freshness** per WHOLE-NINE-YARDS Phase 3 (stats/timeline/
  players each show own last-received time).
- **C2. MLB/NHL full feeds.** `statsapi.mlb.com/…/feed/live` and NHL `right-rail`/
  `play-by-play`/`landing` are already verified in ENDPOINTS.md — richer than ESPN
  summary for those two leagues.
- **C3. Soccer depth.** API-Football fixtures/statistics/events/lineups (key
  required, ~100 req/day free) would upgrade soccer Game Centers to near-ESPN parity.

### Track D — Hygiene (do first)

1. **Commit the in-flight provider-fallback work — complete** (`bca8664`).
2. **Resolve the dead demo code — complete**: the unused demo components, library,
   and test were deleted because a fictional sportsbook mode is not a product goal.
3. **Discard or archive the BetMGM scrape** — it's CDN noise.
4. **Keep ESPN odds usage honest**: label as "market reference," cache per event,
   respect the undocumented-API risk (prototype/internal posture per ENDPOINTS.md).

---

## 5. Phased roadmap

| Phase | Contents | Gate |
|---|---|---|
| **P0 — Hygiene** | Commit fallback work; resolve dead demo code; archive BetMGM scrape | `typecheck`/`test`/`build` green; no orphaned routes |
| **P1 — Trust signals** | A1 implied-probability display (ESPN odds, capped, cached, labeled); pick-consensus % from COWBOY picks; A5 fixture contract tests | Unit tests for odds→probability conversion; no request can hang; labels honest |
| **P2 — Retention** | B4 share cards; B1 opt-in notifications; B3 news previews | a11y + permission UX reviewed; no silent notifications |
| **P3 — Depth** | A3 line movement indicators; C1 section freshness; C2 MLB/NHL feeds; B2 contests (if P2 retention metrics justify) | Visual regression at 390/414/834/1280px |
| **P4 — Optional keys** | A4 props via API-Football key; A2 market-consensus blend; C3 soccer depth; SportsDataIO evaluation | Cost/terms review; quota monitoring in place |

**Explicit non-goals** (unchanged from FEATURE-PLAN.md): real-money odds-as-prices,
wallets, cash-out settlement, deposits, licensed video, regulated prediction-market
contracts. Market data may be *displayed as reference*; it must never be *stakeable*.

---

## 6. Verification checklist (every phase)

```bash
npm run typecheck
npm test
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 npx playwright test
```

- No horizontal overflow at 390/414/834/1280 CSS px.
- Every provider failure keeps last-good data visible with age/source label.
- Odds/probability UI carries "reference only — not a wager" copy.
- No claim of multi-provider "aggregation," live betting, or cash prizes until implemented and verified.
