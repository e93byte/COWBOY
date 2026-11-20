# COWBOY — Top-6 Feature Gap Closure Handoff

> **Audience:** IDE coding agent working in `/Users/shy/Desktop/SAHAND/COWBOY-github`  
> **Gateway:** `/Users/shy/Desktop/SAHAND/sites/cowboy` (standalone, currently unused by the frontend)  
> **Baseline:** `main` at `78d3b1c`, 3 commits ahead of `origin/main` (`f227e4f`)  
> **Date:** 2026-11-19  
> **Status:** Ready for implementation. Do not mark any task complete without the evidence listed in §7–§8.
>
> **Next.js version warning:** this repo uses Next.js 16.4.6 with breaking changes. Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (resolved from the repo root). Do not rely on training-data conventions. Keep the `AGENTS.md` block intact.

This document supersedes `docs/HANDOFF-ROADMAP.md` for **feature/product work**. The deploy checklist in that roadmap is still valid. For visual/UI polish, see `docs/TOP-6-UI-UX-EXAMINATION.md`; that document benchmarks a different set (FanDuel, DraftKings, BetMGM, bet365, Fanatics, Caesars) and focuses on styling, not product surface.

---

## 0. TL;DR for the agent

COWBOY is a free-to-play sports board with a moneyline pick'em game. It is **not** yet a sportsbook-equivalent product. The top-6 benchmark (FanDuel, DraftKings, BetMGM, Caesars, ESPN BET, BetRivers) exposes five gaps that matter:

1. **Only moneyline is pickable.** Spreads, totals, props, and futures are display-only.
2. **No parlay/SGP slip.** Multi-pick entries exist, but there is no combined odds or correlation.
3. **No live markets.** Picks lock at game start.
4. **No engagement loop.** No leaderboards, contests, badges, rewards, or referrals.
5. **Production is partially trustworthy.** Tests and typecheck now pass, but account/pick storage returns 409, the latest work is uncommitted, and the gateway is unused and has a key-redaction defect. The old five-route 404 finding is stale; those routes now resolve. See `docs/API-INVENTORY-AND-EXPOSURE.md`.

Do the work in this order:

```
Phase 0  Fix typecheck → commit/deploy current work → verify Supabase → decide gateway → browser-verify odds UI
Phase 1  Pickable spread/total → pickable props → pickable futures → parlay slip → live markets v1 → leaderboard v1
Phase 2  Account recovery/verification → email/push notifications → public profiles/social → badges/streaks/referrals → contests
Phase 3  SGP correlation → betting splits/trends/player logs → model projections/edge → futures breadth → missing sports → SEO/PWA
```

**Hard rule:** COWBOY is free-to-play. No real-money wallet, deposits, withdrawals, KYC, cash out, or licensed promotions. Use "pick", "entry", "virtual return", and "would return" — never "bet", "wager", or "payout" in user-facing copy.

### 0.1 Kickoff prompt (copy into the IDE)

```text
Read docs/HANDOFF-TOP6-GAP-CLOSURE.md in full. Start with Phase 0 only.

1. Confirm the local gate: npm test (175 pass), npm run typecheck (0 errors), npm run build, npm run test:e2e.
2. Report the exact output and any failures.
3. Do not commit, push, or start Phase 1 until I approve.
4. Then follow Phase 0 checkboxes; production account/pick storage is the current blocker.

After Phase 0 is approved, proceed one checkbox at a time and update the document with evidence.
```

---

## 1. Current state — read before changing anything

### 1.1 Repository state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `322df9f fix: add odds tab icon required by Game Center` |
| `origin/main` | `322df9f` (in sync) |
| Ahead of origin | 0 commits |
| Uncommitted | 6 modified files + 2 new docs (`docs/HANDOFF-TOP6-GAP-CLOSURE.md`, `docs/API-INVENTORY-AND-EXPOSURE.md`) |
| Unit tests | **175 pass / 0 fail** (`npm test`, 2026-11-20) |
| Typecheck | **passes** (`npm run typecheck`, 2026-11-20) |
| Build | Re-run before shipping (`npm run build`) |
| Playwright | `tests/browser/*.spec.ts`; config in `playwright.config.ts`; run `npm run test:e2e` |

Uncommitted files:

```
M app/lib/futures-markets.ts
M app/lib/player-props.ts
M app/lib/sports-leagues.ts
M docs/HANDOFF-ROADMAP.md
M tests/futures-markets.test.ts
M tests/live-sports.test.ts
?? docs/HANDOFF-TOP6-GAP-CLOSURE.md
?? docs/API-INVENTORY-AND-EXPOSURE.md
```

### 1.2 What is already shipped in the working tree

- Live scores/status across **60 leagues / 15 sports**.
- Reference odds on cards and in a new **Odds tab**: moneyline, spread, total, implied probability, line movement, multi-book comparison.
- **Display-only** player props (12 shown, DraftKings via ESPN, roster name resolution).
- **Display-only** Kalshi futures (championship boards, 10 outcomes).
- League news, standings, injuries, lineups, team schedule, recent results, leaders.
- Moneyline picks: home/away/draw, up to 5 games per entry, edit/cancel before start, history, accuracy, streak text, pick consensus.
- Watchlist/following, comparison, search/filters, timezone/odds format preferences.
- Account: username/password, sessions, export, delete, follows.
- Responsible limits: daily pick limit, self-exclusion, help center.
- Browser notifications for followed games.

### 1.3 What is committed but not proven in production

- Supabase account/pick backend: `app/lib/supabase-store.ts`, `app/lib/store-backend.ts`, migration `supabase/migrations/20260714000000_cowboy_account_store.sql`.
- `.env.local` has `COWBOY_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set locally.
- **Production Vercel env vars and migration status are unverified.** The file store remains the default when Supabase env vars are absent.

### 1.4 Production reality

As of 2026-11-20 05:39 UTC, the deployed app is **not** the older build that returned 404s. These routes return 200:

```
/api/sports
/api/sports/futures
/api/sports/props
/api/sports/news
/api/sports/market
```

The current production failure is account/pick storage, not routing:

```
/api/picks                    409 service_unavailable
/api/picks/consensus          409 service_unavailable
/api/account/export           409 service_unavailable
/api/account/follows          409 service_unavailable
/api/account                  200 {"user":null}
```

Do not repeat the old "five routes 404" claim. Verify storage and the board's `fetchedAt` after deploying. Full evidence: `docs/API-INVENTORY-AND-EXPOSURE.md` §3.

### 1.5 Gateway reality

`sites/cowboy` has **14 providers, 369 leagues, 137 market definitions, 31 sports**. It is a standalone server and the Next.js frontend never calls it. It is the cheapest coverage win available, but it must be wired or formally retired.

There is also a second, divergent gateway at `sites/sources-for cowboy`: 17 providers (adds local FanDuel/BetMGM scrapes and a Supabase sink), 178 leagues, 137 markets, real keys in `.env`, five stub routes, and a missing `/api/sports` route. Do not merge it into `sites/cowboy`. Both gateways currently bind all interfaces, allow `*` CORS, and have no auth; the second one also echoes the Odds API key in error attempts. See `docs/API-INVENTORY-AND-EXPOSURE.md` §4 and §8 before wiring either one.

### 1.6 Benchmark set

Use these six for product parity:

| Book | Signature features to benchmark |
|---|---|
| **FanDuel** | Same Game Parlay, SGP+, Live SGP, Cash Out, Odds/Profit Boosts, FanDuel Research/TV, DFS |
| **DraftKings** | SGP/SGP+, **DK Pick6**, DFS, Stats Hub/Betting Splits, Progressive Parlay, Cash Out, Odds Boosts |
| **BetMGM** | SGP, Cash Out, MGM Rewards, Odds Boosts, Live Betting |
| **Caesars** | SGP, Caesars Rewards, Odds Boosts, Live Betting, Cash Out |
| **ESPN BET** | SGP, ESPN stats/highlights integration, Odds Boosts, Live Betting, Cash Out |
| **BetRivers** | SGP, Cash Out, iRush Rewards, Odds Boosts, Live Betting, fast payouts |

DraftKings Pick6 is the closest analogue to COWBOY: free-to-play, prop-based, contest-driven, leaderboard-driven.

### 1.7 Coverage math

| Dimension | Top-6 typical | COWBOY frontend | Gateway (unused) |
|---|---|---|---|
| Sports | 20–30+ | 15 | 31 |
| Leagues | 100+ | 60 | 177 |
| Pickable markets/event | Dozens–hundreds | **1** (moneyline) | 137 definitions |
| Player props | Dozens/event, alt lines | 12 display, 0 pickable | Provider-dependent |
| Futures | Championship, division, conference, awards, win totals | Championship only, 10 outcomes | Kalshi/Polymarket |
| Live markets | Yes | Scores only; picks lock at start | Live scores only |
| Parlay/SGP | Combined odds, correlation | Multi-pick entry, no combined odds | — |
| Leaderboards/contests | DFS/Pick6/pick'em | None | — |

---

## 2. Gap matrix

Legend: ✅ parity for a free-to-play picks product · 🟡 partial · ❌ missing · ⚪ out of scope by design

| Area | Top-6 standard | COWBOY today | Gap |
|---|---|---|---|
| Sports/leagues | 20–30+ sports, 100+ leagues | 15 sports, 60 leagues | 🟡 missing F1/NASCAR, boxing, cricket, darts, snooker, table tennis, esports, college baseball/softball |
| Core markets | ML, spread, total, team total | ML pickable; spread/total display-only | ❌ critical |
| Player props | Dozens/event, alt lines, pickable | 12 reference props, no picks, no alternates | ❌ critical |
| Game props/alt lines | Standard | None | ❌ |
| Futures | Championship, division, conference, awards, win totals | Kalshi championship boards, 10 outcomes | 🟡 |
| Live markets | In-play odds/markets | Live scores only; picks lock at start | ❌ critical |
| Parlay/SGP | SGP, SGP+, live SGP, combined odds | Multi-pick entry up to 5, no combined odds/correlation | ❌ critical |
| Cash out | Standard | Edit/cancel before start only | ⚪ wagering-only; free-to-play equivalent partial |
| Odds boosts/promos | Standard | None | ⚪/❌ free-to-play equivalents missing |
| Rewards/loyalty | Standard | None | ❌ |
| Leaderboards/contests | DFS, Pick6, pick'em contests | None | ❌ critical for free-to-play |
| Stats/insights | Splits, trends, H2H, player logs, projections | Standings, injuries, lineups, recent results, leaders, pick consensus | 🟡 |
| Betting splits/line movement | Standard on most | Multi-book odds, implied %, movement; pick consensus is COWBOY users, not market splits | 🟡 |
| News/content/video | News, analysis, highlights | League news; no video or expert analysis | 🟡 |
| Search/discovery | Search, filters, personalized feed | Search, filters, watchlist, following, comparison, date filters | ✅/🟡 |
| Account | Email/phone, reset, verification, 2FA, OAuth, profile | Username/password, sessions, export/delete, follows | 🟡 |
| Notifications | Push/email/SMS, results, line movement, promos | Browser notifications for followed games | 🟡 |
| Responsible play | Limits, self-exclusion, resources | Daily pick limits, self-exclusion, help center | ✅ for free-to-play |
| Wallet/KYC | Deposits, withdrawals, KYC, cash out | None | ⚪ by design |
| Platform | Managed DB, shared rate limits, observability, CSP | JSON/Supabase adapter, in-memory limits, no edge rate limit, gateway unused, prod storage 409 | ❌ critical |

---

## 3. Work plan

Use one branch per phase. Keep commits small and scoped. Update this document's checkboxes as you go.

### Phase 0 — Stabilize and ship (do this first)

- [x] **0.1 Confirm the local gate is green.**
  - `npm test` → 175 pass, 0 fail (2026-11-20).
  - `npm run typecheck` → 0 errors (2026-11-20).
  - Do not weaken production types; keep the Supabase test typed.
  - Acceptance: both commands exit 0.

- [ ] **0.2 Run the full local gate.**
  - `npm test` → 175+ pass, 0 fail.
  - `npm run typecheck` → 0 errors.
  - `npm run build` → green.
  - `npm run test:e2e` → all `tests/browser/*.spec.ts` pass.

- [ ] **0.3 Commit the pending odds/leagues/props/futures work.**
  - Include the pending files listed in §1.1. Commit the audit separately from the feature work if possible.
  - Suggested messages: `feat: add reference odds, expand soccer coverage, and deepen props/futures` and `docs: add API inventory and exposure audit`.
  - Do not commit `.env.local`, `.cowboy-data/`, or any secret.
  - Acceptance: clean `git status`, tests/typecheck/build still green.

- [ ] **0.4 Deploy and verify.**
  - Push `main` only after the user authorizes it.
  - Confirm Vercel deployed the new commit.
  - Verify these return 200 with non-empty JSON:
    - `/api/sports`
    - `/api/sports/event?...`
    - `/api/sports/futures`
    - `/api/sports/props`
    - `/api/sports/news`
    - `/api/sports/market`
  - `/api/picks/consensus` is storage-dependent: currently 409 `service_unavailable`; verify it after 0.5.
  - Acceptance: curl output + deployment URL recorded in this doc.

- [ ] **0.5 Verify Supabase in production (current blocker).**
  - Current evidence (2026-11-20): `/api/picks`, `/api/picks/consensus`, `/api/account/export`, and `/api/account/follows` return 409 `service_unavailable`; `/api/account` returns `{"user":null}`.
  - Confirm `COWBOY_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in Vercel (server-only, never `NEXT_PUBLIC_`).
  - Apply `supabase/migrations/20260714000000_cowboy_account_store.sql` to the production project if it is not applied.
  - Verify register → login → save picks → list picks → export → delete on production.
  - Acceptance: no writes to `.cowboy-data/store.json` in production; `storage_unavailable` is not thrown.
  - If production Supabase is not ready, document it as a blocker and keep the file store local-only.

- [ ] **0.6 Decide the gateway: wire or retire.**
  - **Recommended:** wire it server-side behind the Next.js API as a read-only fallback for coverage/markets.
    - Add `COWBOY_GATEWAY_URL` (server-only).
    - Proxy only the read endpoints; never expose provider keys.
    - Keep the existing ESPN path as primary; use the gateway when ESPN is empty or a league is unsupported.
    - Add a test that proves fallback works when the primary returns empty.
  - **Alternative:** retire it from the product surface and keep it as a research tool.
  - Acceptance: written decision in this doc + code/test if wired.

- [ ] **0.7 Browser-verify the Odds UI.**
  - Add a Playwright spec covering: card odds strip, Odds tab, ML/spread/total, implied %, movement, multi-book table.
  - Check 390px, 834px, 1280px.
  - Acceptance: no horizontal overflow, no console errors, screenshot attached.

### Phase 1 — Market parity

- [ ] **1.1 Make spread and total pickable.**
- [ ] **1.2 Make player props pickable.**
- [ ] **1.3 Make futures pickable.**
- [ ] **1.4 Add a parlay slip with combined odds.**
- [ ] **1.5 Add live markets v1 (moneyline/spread/total).**
- [ ] **1.6 Add leaderboard v1.**

### Phase 2 — Trust and engagement

- [ ] **2.1 Account recovery, email verification, 2FA, OAuth.**
- [ ] **2.2 Email + web-push notifications.**
- [ ] **2.3 Public profiles, follow users, shared pick cards.**
- [ ] **2.4 Badges, streaks, referrals.**
- [ ] **2.5 Free-entry contests.**

### Phase 3 — Differentiation

- [ ] **3.1 SGP correlation/pricing.**
- [ ] **3.2 Betting splits, trends, H2H, player logs.**
- [ ] **3.3 Model projections and edge labels.**
- [ ] **3.4 Futures breadth (divisions, conferences, awards, win totals).**
- [ ] **3.5 Missing sports: F1, NASCAR, boxing, cricket, darts, snooker, table tennis, esports.**
- [ ] **3.6 Licensed highlights/video (only if rights exist).**
- [ ] **3.7 SEO pages, PWA, accessibility audit.**

---

## 4. Detailed specifications

### 4.1 Market model expansion

**Problem:** `PickSide` is `'home' | 'away' | 'draw'` in `app/lib/pick-outcomes.ts`, and `validatePick` in `app/lib/pick-service.ts` only accepts those. The Odds tab can display spreads and totals, but users cannot pick them.

**Design:**

Create a market-aware selection model. Keep legacy tickets working: a ticket without `market` defaults to `moneyline`.

```ts
export type PickMarketKind = 'moneyline' | 'spread' | 'total' | 'prop' | 'future';

export type PickSelection = {
  market: PickMarketKind;
  side: 'home' | 'away' | 'draw' | 'over' | 'under';
  line?: number | null;       // spread/total/prop line
  price?: number | null;      // American odds at pick time
  playerId?: string;          // prop
  propType?: string;          // prop
  outcomeId?: string;         // future
  selectionKey: string;       // stable unique key within the event/market
};
```

**Data changes:**

- Extend `StoredPick` and `RealPickTicket` in `app/lib/account-store.ts` / `app/lib/pick-service.ts` with the fields above.
- Add a **new** Supabase migration; do not edit an applied migration.
- Add `market`, `line`, `price`, `player_id`, `prop_type`, `outcome_id`, `selection_key` columns to `cowboy_picks`.
- Change the uniqueness rule from `(user_id, league, event_id)` to `(user_id, league, event_id, market, selection_key)` so a user can pick a spread and a total on the same game, but not duplicate the same market.
- Update `cowboy_save_picks`, `cowboy_pick_json`, and `cowboy_change_pick` for the new fields.
- Backfill legacy rows: `market = 'moneyline'`, `selection_key = side`.

**Validation:**

- `moneyline`: side `home|away|draw`; draw only for leagues where `supportsDrawPick`.
- `spread`: side `home|away`; `line` required; `price` required.
- `total`: side `over|under`; `line` required; `price` required.
- `prop`: side `over|under`; `line`, `playerId`, `propType` required.
- `future`: `outcomeId` required; no event-side requirement.

**Grading:**

Add a pure `gradePick(pick, event)` function. Rules:

- Moneyline: winner side; draw only when the league supports it.
- Spread: `homeScore + line` vs `awayScore`; exact equality → `void` (push).
- Total: `homeScore + awayScore` vs `line`; exact equality → `void`.
- Prop: compare the player's stat to `line`; exact equality → `void`; missing stat → `void`.
- Future: resolve from the provider's final outcome; missing → `void`.
- Never regrade with the current line; use the stored `line` and `price`.

**UI:**

- `EventDetail` Odds tab: make each ML/spread/total cell a pick button. Show the line and price on the button.
- `EventDetail` Props tab: add over/under pick buttons per prop.
- `EventDetail` Futures component: make each outcome a pick button.
- `LiveWorkspace` review modal: show `market`, `line`, `price`, and `selection`.
- `AccountPicks` history: show the market/line, not just the team name.

**Tests:**

- Validation accepts/rejects each market correctly.
- Duplicate same market is rejected; different markets on the same event are allowed.
- Legacy ticket without `market` still lists and grades as moneyline.
- Spread/total push → void; prop push → void; missing stat → void.
- UI typecheck/build.

**Acceptance:** a user can submit a spread, total, prop, and future pick; each appears in history with the correct line; each grades correctly; all existing tests still pass.

---

### 4.2 Parlay slip with combined odds

**Problem:** Multi-pick entries are grouped by `entryId`, but each leg is independent. There is no combined odds, payout preview, or parlay grading.

**Design:**

- Add `entryType: 'single' | 'parlay'` to the entry metadata.
- For v1, allow cross-game parlays only. Same-game legs are blocked with a clear message: “Same-game parlays are coming soon.” This avoids shipping a fake SGP price.
- Compute combined decimal odds as the product of leg decimal odds. Convert back to American for display.
- Show a virtual stake selector ($1/$5/$10) and “would return” amount. Do not call it a payout or wager.
- Grade the entry: all legs won → won; any leg lost → lost; void legs are removed; all void → void. If a void leg is removed, recompute the reduced return for display only.

**Files:**

- `app/lib/odds.ts` — add `decimalOdds`, `combineDecimalOdds`, `decimalToAmerican`.
- `app/lib/pick-service.ts` — entry-level validation/grading.
- `app/components/AccountPicks.tsx` — `PickPanel`, review modal, history group.
- `app/components/LiveWorkspace.tsx` — selection state, max legs, cross-game rule.

**Tests:**

- 2-leg and 3-leg combined odds math.
- Void leg handling.
- Lost leg handling.
- Same-game legs rejected in v1.
- Existing single-pick flow unchanged.

**Acceptance:** a 3-leg cross-game entry shows combined odds and a virtual return; history shows one entry with leg results; grading is correct.

---

### 4.3 Live markets v1

**Problem:** `assertScheduled` in `app/lib/pick-service.ts` rejects any event that is not scheduled. Live games have no pick surface.

**Design:**

- Add `assertMarketOpen(event, now, market)`:
  - `scheduled`: allow until `startsAt`.
  - `live`: allow `moneyline|spread|total` only; require fresh odds; no props in v1.
  - `final`/`completed`: reject.
- Store the line and price at pick time.
- Show a “LIVE” badge and the market’s `fetchedAt`; disable the button if odds are missing or stale.
- Do not allow edits/cancels after the market closes.
- Settlement uses the stored line, not the live line.

**Files:**

- `app/lib/pick-service.ts` — gating.
- `app/lib/live-sports.ts` — live odds freshness.
- `app/components/EventDetail.tsx` — live pick buttons.
- `app/components/LiveWorkspace.tsx` — live board pick buttons.
- `app/lib/score-refresh.ts` — reuse the existing pacing; do not add a second poller.

**Tests:**

- Scheduled → allowed before start, rejected at/after start.
- Live → allowed for ML/spread/total; rejected for props.
- Final → rejected.
- Stale odds → rejected with a clear error.
- Line stored at pick time and used for grading.

**Acceptance:** a user can pick a live game; the ticket stores the live line; the pick settles from the final score; no duplicate polling.

---

### 4.4 Leaderboard v1

**Problem:** There is no leaderboard, contest, badge, or reward. This is the biggest free-to-play engagement gap.

**Design (v1, compute on demand):**

- API: `GET /api/leaderboard?window=daily|weekly|season&limit=50`.
- Aggregate settled picks (`won`/`lost`), exclude `void`/`cancelled`.
- Minimum picks: 5 daily, 10 weekly/season.
- Rank by wins, then win rate, then current streak, then earliest entry.
- Return `{ window, updatedAt, entries: [{ rank, username, wins, losses, winRate, streak }], me? }`.
- Cache: `s-maxage=60, stale-while-revalidate=300`.
- Privacy: username only; no user IDs or emails. Add `leaderboard_opt_out` to `cowboy_users`; default false. If opted out, exclude from public results but still show the user their own rank.

**Files:**

- `app/api/leaderboard/route.ts` (new).
- `app/lib/leaderboard.ts` (new, pure aggregation + tests).
- `app/components/Leaderboard.tsx` (new).
- `app/components/LiveWorkspace.tsx` — nav entry/tab.
- Supabase migration for `leaderboard_opt_out` if using the DB.

**Tests:**

- Aggregation with seeded picks.
- Ties, minimum picks, void/cancelled exclusion.
- Opt-out exclusion.
- Empty state.

**Acceptance:** leaderboard shows top 50 for each window; current user sees their rank; no PII beyond username; tests pass.

---

### 4.5 Account trust

**Problem:** `AccountUser` is `{ id, username }`. There is no password reset, email verification, 2FA, OAuth, profile, or username change. The Supabase adapter is a good start but the account surface is still minimal.

**Design:**

- Add `email` (nullable, unique, lowercased) and `email_verified_at` to `cowboy_users`.
- Password reset:
  - `POST /api/account/password-reset/request` — always returns 200 (no account enumeration).
  - `POST /api/account/password-reset/confirm` — single-use token, 30-minute expiry, invalidate all sessions on success.
- Email verification: token, 24-hour expiry.
- 2FA: TOTP, encrypted secret at rest, recovery codes, rate-limited.
- OAuth: Google/Apple (optional; do not block the rest of Phase 2 on it).
- Profile: username change with uniqueness check, avatar optional, timezone/odds format already exist.
- Keep export/delete/session revoke working.

**Email provider:** Resend is the simplest; SES is acceptable. Add `RESEND_API_KEY` and `COWBOY_EMAIL_FROM` (server-only). In dev, log the email to the console instead of sending.

**Tests:**

- Reset token expiry and single-use.
- No account enumeration (same response for known/unknown email).
- Session invalidation after reset.
- 2FA enable/verify/disable and recovery code.
- Rate limits.

**Acceptance:** reset and verification work end-to-end in dev; production env documented; no secrets in the client bundle.

---

### 4.6 Notifications

**Problem:** Browser-only notifications for followed games. No email, push, SMS, pick-result, or line-movement alerts.

**Design:**

- Email first (same provider as 4.5).
- Web push second (VAPID; `push_subscriptions` table; service worker).
- Events: pick settled, game starting (30 min), followed team news, contest result, line movement above a threshold.
- Preferences: per-channel, per-event; quiet hours; unsubscribe link.
- Idempotency: `notification_log` with a unique key per user/event/type.

**Tests:**

- Preference gating.
- Idempotency (no duplicate sends).
- Unsubscribe.
- Quiet hours.

**Acceptance:** a settled pick sends exactly one email/push; preferences are respected; unsubscribe works.

---

### 4.7 Insights and splits

**Problem:** The app has standings, injuries, lineups, and recent results, but no betting splits, trends, H2H, player logs, or projections.

**Design (free-first):**

- Market implied % vs COWBOY pick % (already have both data sources).
- ATS/OU records from final scores.
- Head-to-head from team schedules.
- Player game logs from ESPN summary/boxscores.
- Line movement history from the stored odds snapshots.
- Label every source and `fetchedAt`; never fabricate a split.

**UI:** a “Trends” tab in `EventDetail` with compact tables, not a wall of charts. Use the existing `cw-game-section` patterns.

**Tests:**

- Normalization for each data type.
- Missing data → explicit “unavailable”, not zeros.
- Stale data → `fetchedAt` + stale label.

**Acceptance:** at least the NBA/NFL/MLB/NHL/soccer majors show real trends; no fake numbers.

---

### 4.8 Platform hardening

- **Supabase production:** apply migration, set env vars, verify RPCs.
- **Rate limiting:** move `MutationLimiter` to a shared store (Upstash Redis or a Supabase table). Current in-memory limiter is per-instance.
- **CSP/HSTS:** already present in `next.config.*` / Vercel (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, HSTS). Keep them; add edge rate limits and an origin allowlist if the gateway is wired. No `unsafe-eval` in production.
- **Observability:** Sentry or OpenTelemetry; log provider failures, gateway fallbacks, and Supabase errors. Keep `Server-Timing`.
- **Gateway:** wire or retire (§0.6).
- **Deploy:** push, verify routes, verify freshness.

**Acceptance:** security headers present; shared rate limit verified across two instances; errors visible in the observability tool; production routes 200.

---

## 5. Data and provider rules

- **Free-first.** Prefer keyless providers; paid keys are fallbacks only.
- **No scraping FanDuel/DraftKings.** Do not bypass PerimeterX, geo-blocks, or bot protections. The FanDuel mirror is off-limits.
- **No demo data.** No fake games, fake odds, or placeholder picks in production.
- **Every number needs a source and timestamp.** If a provider is stale, show stale; if unavailable, show unavailable.
- **Odds are display/reference only.** Never present them as a wager or a guarantee.
- **Gateway providers:** `sites/cowboy` has 14 registered / 369 leagues; 3 need keys (`ODDS_API_KEY`, `API_FOOTBALL_KEY`, `SPORTSDATAIO_KEY`); SportsDB uses the test key `123`. Do not ship a keyless provider that returns synthetic data. The second gateway at `sites/sources-for cowboy` is **not canonical** (17 providers / 178 leagues) and has stub routes.
- **Never serialize raw upstream errors.** `HttpError` embeds the full URL; The Odds API key is a query parameter; `RouterError.attempts` is returned to clients. Redact query strings and return only `provider/status/ms`. The gateway currently leaks a fake key in this path (confirmed) and would leak a real one.
- **No public gateway.** Bind to `127.0.0.1`; if it must listen remotely, add auth and an origin allowlist. `access-control-allow-origin: *` is not acceptable with provider keys or a Supabase key.
- **API audit:** see `docs/API-INVENTORY-AND-EXPOSURE.md` for the 65-source probe, free/keyed/paid classification, blocked/dead list, route exposure, and key-handling findings.
- **Kalshi:** respect rate limits; keep the cache/backoff; do not probe every series.
- **ESPN:** the scoreboard embeds DraftKings odds, so odds cost zero extra requests. Keep that path.

---

## 6. Non-goals

Do **not** build these unless the product becomes a licensed sportsbook:

- real-money wallet, deposits, withdrawals
- KYC/identity verification
- cash out with cash value
- licensed odds boosts/promos
- affiliate bonusing
- streaming rights or unlicensed video

Do **not**:

- add demo entrypoints
- rebuild provider code or blindly merge `COWBOY-github` and `sites/cowboy`
- expose `SUPABASE_SERVICE_ROLE_KEY` or any provider key to the client
- edit an applied Supabase migration; add a new one
- break the existing moneyline pick flow or its tests
- touch the user's pacing edit in `app/lib/live-sports.ts` without explicit approval

---

## 7. Verification contract

Run these before claiming any phase is done:

```bash
cd /Users/shy/Desktop/SAHAND/COWBOY-github
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected:

- `npm test` → 175+ pass, 0 fail.
- `npm run typecheck` → 0 errors.
- `npm run build` → green.
- `npm run test:e2e` → all `tests/browser/*.spec.ts` pass.

Production checks:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/sports
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/sports/futures
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/sports/props
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/sports/news
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/sports/market
curl -sS -o /dev/null -w "%{http_code}\n" https://betcowboy.vercel.app/api/picks/consensus
```

All must return `200`. Then verify the response bodies are non-empty and include a recent `fetchedAt`.

Browser checks:

- 390px, 834px, 1280px.
- No horizontal overflow.
- Odds tab renders ML/spread/total, implied %, movement, books.
- Card odds strip renders.
- Pick flow works for each new market.
- Console has no errors.

---

## 8. Reporting format

For each task, report:

1. **Files changed** — exact paths.
2. **What changed** — one paragraph.
3. **Tests added/updated** — names and counts.
4. **Commands run** — with pass/fail output.
5. **Evidence** — curl output, screenshot paths, or browser console notes.
6. **Known limitations** — anything not done or not verified.
7. **Next task** — the next checkbox.

Update the checkboxes in §3 as you complete work. Do not mark a task complete if it is only coded but not tested or deployed.

---

## 9. Open decisions

| Decision | Options | Recommendation |
|---|---|---|
| Gateway | Wire vs retire | Wire as a server-side read-only fallback; keep ESPN primary |
| Email provider | Resend vs SES | Resend for speed; SES if AWS is already in use |
| OAuth | Google/Apple vs none | Google first; Apple if iOS matters |
| Leaderboard privacy | Username-only vs opt-in | Username-only + opt-out flag |
| Parlay scope | Cross-game only vs SGP v1 | Cross-game only first; SGP after correlation rules |
| Real-money features | Build vs not | **Do not build** — free-to-play only |
| Top-6 set | FanDuel/DraftKings/BetMGM/Caesars/ESPN BET/BetRivers vs UI doc's set | Use this doc's set for product; UI doc's set for visual |

---

## 10. Risks

- **Market expansion touches settlement and the DB.** Migrate additively; default legacy rows to moneyline; test push/void thoroughly.
- **Live markets require reliable live odds.** Do not ship if odds are stale or missing; show a disabled state.
- **Leaderboards expose usernames.** Add opt-out and never expose emails or IDs.
- **Email/push add infrastructure and secrets.** Keep them server-only; log in dev.
- **Kalshi rate limits.** Keep the cache, backoff, and early-stop behavior.
- **Vercel serverless cold starts + Supabase RPC latency.** Add timeouts and user-facing stale states.
- **Production deploy requires user authorization.** Do not push without it.
- **The existing roadmap is stale.** This document is the source of truth for feature work.

---

## 11. File map

| Concern | Files |
|---|---|
| Pick types/validation | `app/lib/pick-outcomes.ts`, `app/lib/pick-service.ts` |
| Pick storage | `app/lib/account-store.ts`, `app/lib/store-backend.ts`, `app/lib/supabase-store.ts` |
| Supabase schema | `supabase/migrations/20260714000000_cowboy_account_store.sql` (add new migrations, don't edit) |
| Board/UI | `app/components/LiveWorkspace.tsx`, `app/components/EventDetail.tsx`, `app/components/AccountPicks.tsx`, `app/components/SportIcon.tsx`, `app/live.css` |
| Odds | `app/lib/odds.ts`, `app/lib/live-sports.ts` |
| Props | `app/lib/player-props.ts`, `app/components/EventDetail.tsx` |
| Futures | `app/lib/futures-markets.ts`, `app/components/LeagueFutures.tsx` |
| News | `app/lib/sports-news.ts`, `app/components/LeagueNews.tsx` |
| Leaderboard (new) | `app/lib/leaderboard.ts`, `app/api/leaderboard/route.ts`, `app/components/Leaderboard.tsx` |
| API routes | `app/api/sports/*`, `app/api/picks/*`, `app/api/account/*` |
| Gateway | `sites/cowboy/src/index.ts`, `sites/cowboy/src/server.ts`, `sites/cowboy/src/core/router.ts` |
| Tests | `tests/*.test.ts`, `tests/browser/*.spec.ts` |

---

## 12. Handoff checklist

- [ ] Read §0–§2.
- [ ] Confirm baseline: `git status`, `npm test` (175 pass), `npm run typecheck` (0 errors).
- [ ] Confirm the local gate (§0.1–0.2).
- [ ] Commit the pending odds work (§0.3).
- [ ] Deploy and verify routes (§0.4).
- [ ] Verify Supabase production (§0.5).
- [ ] Decide gateway (§0.6).
- [ ] Browser-verify Odds UI (§0.7).
- [ ] Start Phase 1.1 (spread/total).
- [ ] Update this document with evidence as you go.

**Final note:** the goal is not “more leagues.” The goal is a pickable, trustworthy, engaging free-to-play product. Market surface, parlay/live picks, leaderboards, and account trust are the shortest path. Do not claim feature-complete until the production routes, browser flows, and test gates all pass.
