# COWBOY whole-nine-yards plan

## Product promise

COWBOY should feel as deliberate as a top sports score/picks product without pretending to be a licensed money sportsbook. The parity target is interaction quality, speed, clarity, and trustworthy data presentation—not wagering, cash-out, or operator-specific odds.

## Nine experience pillars

| Pillar | Current implementation | Close the remaining gap with |
| --- | --- | --- |
| 1. Trustworthy data | ESPN-primary scoreboard, labeled fallback/last-known-good data, source health, freshness timestamps, bounded board refresh | Add provider contract/fixture monitoring and visible per-surface freshness assertions |
| 2. Premium shell | Obsidian/glass COWBOY design, tactile controls, responsive desktop/mobile navigation | Keep motion restrained, remove any remaining flat/loading dead ends, run visual regression at four target widths |
| 3. Discovery | Sport and league rails, dates/time zones, search, status filters, watchlist, featured/live/upcoming views | Add stable deep links for every meaningful filter and preserve state across navigation |
| 4. Game Center | Overview, score, stats, players, timeline, drives, matchup, schedule, lineups, standings, sharing, follow, live polling | Add explicit freshness per detail section and source-aware retry/last-good behavior |
| 5. Pick entry | Free winner/draw picks, multi-pick draft, review, five-pick cap, session persistence, responsible-play pause | Add clear duplicate/changed-source feedback and stronger confirmation of the exact event/start time |
| 6. Pick lifecycle | My Picks, open/live/settled filters, edit/cancel, re-pick, grading, accuracy, streaks, search/date/league filters | Add durable result history export/readback checks and empty/error states for every filter |
| 7. Personal loops | Account sessions, follows, watchlist, game updates, unread alerts, preferences | Add notification permission UX and user-controlled alert categories; do not silently notify |
| 8. Resilience | Server/client deadlines, stale-while-revalidate, offline scoreboard, partial league results, retry controls | Bound every client JSON request and test stalled account/detail/team-schedule paths |
| 9. Accessibility/performance | Focus management, keyboard dialogs, ARIA labels/statuses, mobile no-overflow probes, unit/E2E coverage | Add reduced-motion/focus regression checks and measure board/detail interaction latency |

## Work sequence

### Phase 1 — Reliability foundation (this session)

- Bound authenticated, Game Center, team schedule, and pick requests with one abort-safe client helper.
- Preserve caller cancellation during unmount/navigation and distinguish timeout copy from user cancellation.
- Add regression tests for timeout and cancellation.
- Keep the board's existing 15-second client and 12-second server deadlines unchanged.

### Phase 2 — Data fidelity

- Add fixture-backed contract tests for normalized event identity, status transitions, score/period lines, fallback labels, and source timestamps.
- Add a provider-health matrix to CI: healthy, partial, stale, malformed, HTML/bot-wall, and hanging responses.
- Add explicit `last good` and `observed at` semantics to every detail section; never replace a newer board score with an older summary.
- Only add a second provider if its license/terms and reconciliation behavior are verified. Until then, label ESPN as the primary source and fallbacks honestly.

### Phase 3 — Premium Game Center

- Keep the current section model, but make the active section and refresh state URL-addressable and keyboard-safe.
- Add compact section-level freshness text and “last received” behavior for stats, timeline, players, and matchup.
- Add visual regression assertions for live score, delayed score, unavailable summary, and scheduled pregame states.

### Phase 4 — Pick lifecycle and retention

- Verify open → live → final → won/lost/void transitions against source snapshots.
- Add an explicit results timeline and export/readback test; preserve previous selections after edits.
- Add streak/accuracy explanations that never imply financial returns or gambling outcomes.

### Phase 5 — Alerts and social quality

- Add opt-in browser notifications for followed games, start, score change, and final.
- Add shareable read-only pick cards/leaderboards only after privacy and account visibility rules are explicit.
- Keep all social surfaces free-to-play and avoid money, odds, stake, or cash-out language.

## Acceptance gates

- No user-visible request can remain in a spinner indefinitely.
- A refresh failure keeps the last usable data visible and states its age/source.
- A source change cannot silently change the event identity or saved pick.
- Every primary action is keyboard reachable, has a visible focus state, and has an actionable error.
- No horizontal document overflow at 390, 414, 834, or 1280 CSS pixels.
- `npm run typecheck`, `npm test`, `npm run build`, and isolated Playwright/E2E runs are green before each phase is called complete.
- Claims of multi-provider aggregation, live betting, odds, cash-out, or cash prizes remain out of product copy until implemented and verified.

## Current honest position

COWBOY already covers the core score-to-pick-to-history journey and has unusually strong resilience/freshness signaling for an early product. It is not feature-identical to DraftKings/FanDuel/BetMGM because those are money sportsbooks, and it should not imitate their regulated-money surfaces. The remaining work is to remove the last reliability and polish gaps, then deepen verified data and user loops without weakening the free-picks promise.

## Source-folder findings applied safely

The first-party material in `sites/sources-for cowboy` was audited separately from its nested dependencies. Its useful product findings fall into three groups:

### Adapted into COWBOY

- **Sport/event iconography:** COWBOY uses an original inline SVG icon system for sport rails, match metadata, Game Center context, picks, history, and source-health/status surfaces. It mirrors the information hierarchy of leading score/picks products without copying operator artwork or scraped assets.
- **Canonical normalization:** source adapters normalize provider payloads before the product sees them. COWBOY keeps that boundary in `app/lib/live-sports.ts`; tests cover event identity, status, team identity, score correction, provider attribution, and fallback matching.
- **Provider-aware freshness:** source router results carry provider, attempts, stale state, and fetch time. COWBOY exposes ESPN/fallback source labels, per-league health, timestamps, stale state, and last-known-good data through the live board.
- **Coalescing and bounded work:** the source router coalesces identical requests and its HTTP layer bounds body reads. COWBOY retains coalesced board/detail requests, a bounded request queue, a response-size limit, explicit abort deadlines, and unread-response cancellation.
- **Failure isolation:** source cache and breaker code motivated a COWBOY per-league ESPN scoreboard circuit. After repeated failures, the league stops spending requests during the cooldown, keeps eligible cached data visible, then permits one half-open probe. Regression coverage verifies closed → open → half-open → closed behavior and scheduler timing.
- **Exact identity and market safety:** source adapters require exact event/team matching and omit unsupported or malformed markets. COWBOY follows the same rule for provider event identity, pick verification, soccer draws, and score/result grading; it does not invent prices or participants.

### Deliberately not activated

- The source folder contains adapters for ESPN, LiveScore, SportsDataIO, The Odds API, NBA/NHL/MLB feeds, soccer feeds, prediction markets, exchanges, and other providers. Those adapters are evidence of a possible future router, not proof that COWBOY may use them. COWBOY remains ESPN-backed with labeled fallbacks until terms, credentials, reliability, reconciliation, and operational ownership are verified.
- The source market catalog includes odds, spreads, totals, props, futures, exchanges, and other wagering surfaces. COWBOY is a free-picks product, so those money/price surfaces remain out of the UI and API rather than being copied or relabeled.
- Source browser headers, pacing profiles, and provider connection settings were not copied into the product. They are provider-specific operational behavior and must not become hidden anti-bot workarounds or retained secrets.

### Remaining evidence gates

- A future multi-provider rollout needs a canonical provider-keyed event identity map, per-capability routing, provider-attempt telemetry, reconciliation tests, and explicit license/terms review.
- A future market rollout needs a separate authorized product decision, market-specific settlement rules, and a no-money/free-picks boundary review; it must not be inferred from the source catalog.
- Current source-derived validation is complete for the implemented resilience slice. It does not establish multi-provider production coverage, odds coverage, or universal league coverage.
