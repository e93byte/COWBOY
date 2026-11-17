# COWBOY

[![GitHub checks](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml)

COWBOY is a free-picks sports web app built with Next.js. Browse real fixtures, follow live games, and track your calls from entry to confirmed result. Picks have no stakes, payouts, or prizes.

## Quick start

Use Node.js 22 and npm. No API key is required for local sports data.

```sh
git clone https://github.com/e93byte/COWBOY.git
cd COWBOY
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3213
```

Open [COWBOY on port 3213](http://127.0.0.1:3213). Create a local test account, select an upcoming matchup, and confirm your first pick.

## Explore the app

| Page | What to try |
| --- | --- |
| Home | Filter the schedule by sport, league, and date. Follow a matchup or add up to five independent free picks to your draft. |
| Live | Follow in-progress scores or browse recent finals. Filter to watched matchups. |
| Game Center | Open a game for scores, play-by-play, lineups, and player stats where available. Share a link to a specific section. |
| My Picks | Review results, or change an eligible pick before its game starts. |
| Preferences | Set your schedule timezone and followed-game alerts. |

## Live data and recovery

- Active leagues and open live games are checked about every **5 seconds** while the app is visible. Idle leagues are checked about every **15 seconds**. ESPN controls when it publishes updates, and request time adds to these intervals.
- Concurrent requests share the server cache. A rate-limited scoreboard league backs off for at least 30 seconds. The scoreboard can retain the last successful league response for up to five minutes and labels its original timestamp.
- If the ESPN event summary fails, Game Center can show the last scoreboard response for that exact league and event and retain details it already received. The app labels the fallback. Pick verification still requires current source data.
- The installed web app can show the last saved scoreboard offline. Coverage varies by league, and both the scoreboard and summary come from ESPN.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts a development server on port 3210 by default. To run the browser tests against the preview on port 3213, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3213 npm run test:e2e`. GitHub Actions checks the production build and runs the browser suite against it.

To serve the built app, run `npm run start -- --hostname 127.0.0.1 --port 3213` after `npm run build`.

## Project map

| Path | Responsibility |
| --- | --- |
| `app/components/LiveWorkspace.tsx` | Boards, filters, live polling and draft picks |
| `app/components/EventDetail.tsx` | Game Center, summary polling and fallback display |
| `app/components/AccountPicks.tsx` | Accounts, draft slip and My Picks |
| `app/lib/live-sports.ts` | ESPN adapter, normalization, cache and request limits |
| `app/api/` | Sports, account and pick APIs |
| `public/sw.js` | Offline scoreboard support |
| `tests/` | Unit tests, fixtures and browser journeys |

## Local data and deployment

Account data lives in `.cowboy-data/` by default. Set `COWBOY_DATA_DIR` to an absolute path to choose a different local directory. Keep local data and secrets out of Git. Before hosting this app for other users, replace the local account store with production storage and verify usage rights for distributed sports data and artwork.
