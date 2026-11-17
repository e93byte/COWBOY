# COWBOY

COWBOY is a Next.js app for real sports scores and free pregame picks. Home shows schedules and followed matchups. Live shows in-progress games and recent finals, and Game Center displays the scores, lineups, plays, and player stats ESPN supplies. My Picks tracks saved picks and confirmed results. Preferences controls the schedule timezone and followed-game alerts.

## Run locally

Use Node.js 22 and npm. The project uses a lockfile and needs internet access to install packages and fetch scores. Local development requires no API key.

```sh
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3213
```

Open [COWBOY](http://127.0.0.1:3213). To try a pick, create a separate local test account using a unique password, select an upcoming game, and confirm. Use **My Picks → Refresh results** to check for confirmed results.

## Verify a change

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts its own dev server on port 3210 by default. To test an already running preview, set `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3213`. To run the production build locally, use `npm run start -- --hostname 127.0.0.1 --port 3213`.

## Project map

| Path | What to find |
| --- | --- |
| `app/components/LiveWorkspace.tsx` | Sports board, Live, filters, selection flow |
| `app/components/EventDetail.tsx` | Game Center, matchup and player details |
| `app/components/SportsGlance.tsx` | In-app Home widget for followed games |
| `app/components/AccountPicks.tsx` | Account dialogs, My Picks, record and history |
| `app/lib/live-sports.ts` | ESPN adapter, event normalization, cache and retries |
| `app/api` | Sports, account, and free-pick route handlers |
| `public/sw.js` | Offline support for the last saved scoreboard |
| `tests` | Unit fixtures and browser journeys |

## Demo boundaries

COWBOY polls public ESPN scoreboards about every 15 seconds while visible. Availability and stats vary by league. The local account store writes to `.cowboy-data/` by default. Set `COWBOY_DATA_DIR` to use a separate directory. Keep the app bound to loopback for the handoff. A hosted release needs a production account store and verified rights for distributed artwork, team marks, and sports data.

The app uses free picks with no deposits, payouts, or cash prizes. The Home widget is a web component. Local records, competitor captures, APKs, and development artifacts are outside the handoff.
