# COWBOY

[![GitHub checks](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml)

COWBOY is a free-picks sports web app built with Next.js. Browse real fixtures, follow live games, and track your calls from entry to confirmed result. Picks have no stakes, payouts, or prizes.

## Quick start

Use Node.js 22 and npm. The sample runs locally with public scores and a file-backed account store. No API key is required.

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
| Home | Filter the schedule by sport, league, and date, including college hockey, international soccer, and European club rugby. Follow a matchup or add up to five independent free picks to your draft. |
| Live | Follow in-progress scores or browse recent finals. Filter to watched matchups. |
| Game Center | Open a game for scores, play-by-play, lineups, player stats, and standings where available. MLB previews show listed probable pitchers. Share a link to a specific section. |
| My Picks | Review accuracy, the last five decided picks, and your current run. Change an eligible pick before its game starts. |
| Preferences | Set your schedule timezone and followed-game alerts. |

## Scores and availability

| Condition | Behavior |
| --- | --- |
| Game live or near its scheduled start | The foreground app checks about every 2 seconds. An idle league is checked about every 8 seconds. |
| Game Center summary unavailable | COWBOY tries that league's scoreboard, even on a direct game link, and retains already loaded details. |
| ESPN hockey scoreboard unavailable | NHL scores can update games from the last ESPN schedule when both teams and the start time match. The interface labels the backup and shows its last check. |
| Both feeds unavailable | The server can retain the last successful ESPN league response for up to 5 minutes, with the original timestamp. The installed PWA can also show its last saved scoreboard offline. |

These intervals are polling targets. Provider publishing cadence, request latency, and retry backoff affect how soon a change reaches the screen. The API shares requests across users in one server process and backs off for at least 30 seconds on HTTP 429. Backup or cached scores are for display. Pick entry and settlement require ESPN verification.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts a development server on port 3210 by default. To run the browser tests against the preview on port 3213, use `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3213 npm run test:e2e`. GitHub Actions installs locked dependencies, audits them, runs type checks and unit tests, builds for production, and runs browser tests against that build.

To serve the built app, run `npm run start -- --hostname 127.0.0.1 --port 3213` after `npm run build`.

## Project map

| Path | Responsibility |
| --- | --- |
| `app/components/LiveWorkspace.tsx` | Boards, filters, live polling and draft picks |
| `app/components/EventDetail.tsx` | Game Center, summary polling and fallback display |
| `app/components/AccountPicks.tsx` | Accounts, draft slip and My Picks |
| `app/lib/live-sports.ts` | ESPN adapter, normalization, cache and request limits |
| `app/lib/nhl-score-fallback.ts` | NHL score matching for ESPN outages |
| `app/api/` | Sports, account and pick APIs |
| `public/sw.js` | Offline scoreboard support |
| `tests/` | Unit tests, fixtures and browser journeys |

## Local data and deployment

Account data lives in `.cowboy-data/` by default. Set `COWBOY_DATA_DIR` to an absolute path to choose a different local directory. Keep local data and secrets out of Git. Before hosting this app for other users, replace the local account store with production storage and verify usage rights for distributed sports data and artwork.
