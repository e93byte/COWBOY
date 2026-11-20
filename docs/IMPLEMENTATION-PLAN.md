# COWBOY Implementation Plan — Post-Audit Gap Closure

## Current Status (2026-11-20)

### ✅ Completed
- **Tests**: 194/194 pass
- **Typecheck**: 0 errors
- **Build**: Successful
- **Core Features**: Live scores, free picks, watchlists, game details, PWA, offline scoreboard
- **API Routes**: 21 endpoints functional (sports, odds, picks, account, leaderboard, futures, props, news, market)
- **Gateway**: Canonical `sites/cowboy` with 14 providers / 369 leagues operational

### 🔧 Fixed This Session
- **LiveWorkspace.tsx**: Fixed broken ternary operator causing TypeScript errors
  - Added proper `{view !== 'picks' ? (...) : (...)}` structure
  - Integrated `PickLeaderboard` component for board/live views
  - Maintained `PicksHistory` for picks view

---

## Gap Analysis (from HANDOFF-TOP6-GAP-CLOSURE.md & API-INVENTORY-AND-EXPOSURE.md)

### Phase 0 — Critical Setup (Immediate)

| Item | Status | Action |
|------|--------|--------|
| ODDS_API_KEY | ❌ Missing | Get free key from https://the-odds-api.com (500 credits/mo) |
| Add to .env.local | ❌ Missing | Add `ODDS_API_KEY=<key>` to COWBOY-github/.env.local |
| Verify live odds | ⏳ Pending | Restart server, confirm `/api/sports/market` returns spread/total/props |
| Run full validation | ⏳ Pending | `npm test && npm run typecheck` after key addition |

**Key Exposure Risk**: Second gateway (`sites/sources-for cowboy`) has real Supabase credentials on disk. Rotate keys after Phase 0.

---

### Phase 1 — Spread/Total Picks Validation (1-2 weeks)

**Gap**: Current picks only support moneyline. Need spread/total validation and UI.

| Task | Details |
|------|---------|
| Backend validation | Extend `/api/picks` to validate spread/total lines against live odds |
| Line freshness check | Reject picks if line moved > configurable threshold since display |
| UI: Spread/Total pick buttons | Add to `cw-pick-options` in LiveWorkspace event rendering |
| Consensus display | Show pick percentages for spread/total (already in `pickConsensus`) |
| Settlement logic | Update `settlePicks` to handle spread/total outcomes |
| Tests | Add test cases for spread/total pick submission, validation, settlement |

**Files to modify**:
- `app/api/picks/route.ts` — validation
- `app/lib/pick-outcomes.ts` — spread/total evaluation
- `app/components/LiveWorkspace.tsx` — pick UI
- `tests/pick-center.test.ts` — test coverage

---

### Phase 2 — Parlay/SGP Framework (2-3 weeks)

**Gap**: No multi-leg parlay or Same-Game Parlay (SGP) support.

| Task | Details |
|------|---------|
| Parlay data model | `type ParlayLeg = { eventId, league, market, selection, line? }` |
| Parlay builder UI | New view: `/parlay` with leg builder, combined odds preview |
| Correlation engine | SGP: detect correlated legs (e.g., team ML + player over), adjust odds |
| `/api/parlay` endpoint | Validate, price, store parlay tickets |
| Settlement | Grade all legs; parlay wins only if all legs win |
| Cash-out simulation | Fair value based on live leg probabilities |

**Files to create/modify**:
- `app/lib/parlay.ts` — core logic
- `app/api/parlay/route.ts` — endpoints
- `app/components/ParlayBuilder.tsx` — UI
- `tests/parlay.test.ts` — test coverage

---

### Phase 3 — Player Prop Picks (1-2 weeks)

**Gap**: Props data exists (`/api/sports/props`) but no pick UI or validation.

| Task | Details |
|------|---------|
| Prop pick validation | Verify athlete name, line, over/under against live props feed |
| Prop pick UI | Add prop rows to Game Center / event detail |
| Settlement | Grade props using box score data (already in `game-summaries.ts`) |
| Privacy threshold | Respect existing consensus privacy (min 5 pickers) |

**Files to modify**:
- `app/api/sports/props/route.ts` — already exists
- `app/components/EventDetail.tsx` — add prop pick section
- `app/lib/pick-outcomes.ts` — add prop evaluation
- `tests/player-props.test.ts` — test coverage

---

### Phase 4 — Leaderboard/Contest System (2-3 weeks)

**Gap**: Basic leaderboard exists (`/api/leaderboard`, `PickLeaderboard` component) but no contests.

| Task | Details |
|------|---------|
| Contest data model | Daily/weekly/seasonal contests with entry fees, prize pools |
| Contest API | `/api/contests` — list, join, standings |
| Contest UI | New view: `/contests` with lobby, standings, history |
| Leaderboard enhancements | ROI, streak, profit/loss charts |
| Opt-in privacy | Already implemented (`leaderboardOptIn`) |

**Files to create/modify**:
- `app/lib/contests.ts` — contest logic
- `app/api/contests/route.ts` — endpoints
- `app/components/ContestsView.tsx` — UI
- `tests/contests.test.ts` — test coverage

---

### Phase 5 — Account & Notifications (1-2 weeks each)

| Feature | Tasks |
|---------|-------|
| **2FA** | TOTP setup, backup codes, enforce for sensitive actions |
| **Profile** | Avatar, display name, pick history export, data deletion |
| **Push notifications** | Web Push API for game start, score changes, pick results |
| **Email notifications** | Daily digest, contest reminders, settlement alerts |

**Files to modify**:
- `app/lib/account-store.ts` — 2FA fields, profile fields
- `app/api/account/2fa/route.ts` — new endpoint
- `app/lib/push-notifications.ts` — new module
- `app/components/AccountDialog.tsx` — UI

---

## Risk Mitigation

### Key Exposure (P0)
- **Issue**: Second gateway has real Supabase keys on disk
- **Action**: Rotate `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` after Phase 0
- **Prevention**: Use `.env.example` placeholders only; never commit real keys

### Odds API Key Echo (P1)
- **Issue**: Canonical gateway echoes key in error responses
- **Action**: Review `sites/cowboy/src/router.ts` error handling; sanitize error output

### Blocked Sources (25+)
- **Status**: Documented in `API-INVENTORY-AND-EXPOSURE.md`
- **Action**: No action needed — free sources (ESPN, NBA, MLB, NHL, OpenLigaDB, LiveScore, Kalshi, Polymarket, PredictIt, Matchbook, SportScore) provide sufficient coverage

---

## Verification Gates (Per Phase)

```bash
# After each phase:
npm test          # 194+ tests must pass
npm run typecheck # 0 errors
npm run build     # Successful compilation
npm run test:e2e  # When browser environment available
```

---

## Timeline Summary

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0 | 1 day | ODDS_API_KEY from the-odds-api.com |
| Phase 1 | 1-2 weeks | Phase 0 complete |
| Phase 2 | 2-3 weeks | Phase 1 complete |
| Phase 3 | 1-2 weeks | Phase 1 complete (can parallel Phase 2) |
| Phase 4 | 2-3 weeks | Phase 1-3 complete |
| Phase 5 | 2-4 weeks | Phase 4 complete (2FA/profile parallel notifications) |

**Total estimated**: 7-12 weeks to feature parity with top 6 competitors (FanDuel, DraftKings, BetMGM, Caesars, ESPN BET, BetRivers) for free-to-play predictions scope.

---

## Next Immediate Action

```bash
# 1. Get ODDS_API_KEY from https://the-odds-api.com (free tier)
# 2. Add to COWBOY-github/.env.local:
ODDS_API_KEY=<your_key_here>

# 3. Restart dev server and verify:
npm run dev
# Check /api/sports/market returns spread/total/props

# 4. Run full validation:
npm test && npm run typecheck
```

---

*Generated 2026-11-20 — Post LiveWorkspace.tsx fix, pre-Phase 0*