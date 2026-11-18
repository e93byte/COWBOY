# COWBOY feature completion plan

## Product boundary
COWBOY remains a free-to-play predictions product. No real-money wagering, deposits, payouts, cash-out, odds, or sportsbook execution will be added without a licensed provider, legal/compliance review, geolocation controls, KYC/AML, audited settlement, and secure wallet services.

## Implemented in the current app
- Live game status and pick tracking
- Live pick updates from the real sports feed
- Game details: scores, incidents, team stats, standings, injuries, player data
- Shareable deep links for games and sections
- Edit and cancel open picks with server-side event verification
- Multi-game free-pick slips (the safe equivalent of a cross-event parlay)
- Watchlists, followed-game updates, personalization, offline scoreboard, and PWA support
- Re-bet workflow from pick history
- Discover-style featured/upcoming/live shelves
- Browser-local participation limits and self-exclusion controls for free picks

## Provider/compliance blockers (not honestly markable as complete in this product)
- Licensed live video streaming
- Real-money cash-out and edit-my-bet settlement
- Sportsbook odds, implied probability, player-prop pricing, futures, SGP correlation pricing
- Deposits, withdrawals, wallet ledger, KYC/AML, geolocation, tax reporting
- Production responsible-gaming deposit/wager limits
- Regulated prediction-market contracts

## Verification gates
1. `npm test`
2. `npm run typecheck`
3. `npm run build`
4. `npm run test:e2e` when a browser server and authorized live-feed environment are available

Feature claims must distinguish live provider data from demo or browser-local state.
