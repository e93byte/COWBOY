# COWBOY

[![CI](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/e93byte/COWBOY/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&logoColor=white)

**A friendly place to follow sports and make free picks.** Browse real fixtures, keep an eye on live games, and see how your picks turn out—all without stakes, payouts, or prizes.

## Get started

New to the project? Follow these steps. You’ll need **Node.js 22** and **npm** installed.

### 1. Download the project

```sh
git clone https://github.com/e93byte/COWBOY.git
cd COWBOY
```

### 2. Install dependencies

```sh
npm ci
```

### 3. Start the app

```sh
npm run dev -- --hostname 127.0.0.1 --port 3213
```

### 4. Open it in your browser

Visit [http://127.0.0.1:3213](http://127.0.0.1:3213). Create a local test account, choose an upcoming matchup, and confirm a pick. No API key is needed to try the sample locally.

> **Windows?** Run the same commands in PowerShell. If `npm` is not recognized, install Node.js 22 first, then close and reopen your terminal.

## What you can do

| Area | Try this |
| --- | --- |
| **Home** | Browse the schedule and filter by sport, league, or date. Follow matchups and make up to five independent free picks. |
| **Watchlist** | Keep track of games you follow and return to them later. |
| **Live** | Follow games in progress, browse recent finals, or compare selected matchups. |
| **Game Center** | Explore available scores, play-by-play, lineups, player stats, and standings. |
| **My Picks** | Review your record and recent results. Eligible picks can be changed before a game starts. |
| **Preferences** | Choose your schedule time zone and followed-game alerts. |

Availability varies by sport and data provider. If a score source is temporarily unavailable, COWBOY may show backup or recently saved information and label it accordingly.

## Useful commands

Run these from the project directory:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run typecheck` | Generate Next.js types and check TypeScript. |
| `npm test` | Run the unit tests. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build (run `npm run build` first). |
| `npm run test:e2e` | Run the Playwright browser tests. |

For browser tests, install Chromium once with `npx playwright install chromium`. The tests use port 3210 by default; to run them against the app on port 3213, use:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3213 npm run test:e2e
```

## Project map

| Location | What lives there |
| --- | --- |
| `app/components/` | The main live-sports, game-detail, and account-pick interfaces. |
| `app/lib/` | Sports data, normalization, caching, and fallback logic. |
| `app/api/` | Sports, account, and pick API routes. |
| `public/sw.js` | Offline scoreboard support. |
| `tests/` | Unit tests, fixtures, and browser journeys. |
| `docs/` | Data-source notes and public reference materials. |

## Local data and privacy

Local account data is stored in `.cowboy-data/`. To store it somewhere else, set `COWBOY_DATA_DIR` to an **absolute path**. Keep private data and secrets out of Git. Before hosting the app for other people, review the storage and deployment setup for your environment.

COWBOY is for sports discovery and free picks—not gambling. Picks have **no stakes, payouts, or prizes**.

## Need a hand?

- Check the guides in [`docs/`](docs/) for score-source and project reference notes.
- If something is broken, [open an issue](https://github.com/e93byte/COWBOY/issues) and include what you expected, what happened, and the command or page involved. **Never include passwords, tokens, or private account data.**

## Contributing

Small, clear contributions are welcome. Before opening a pull request, run the checks relevant to your change:

```sh
npm run typecheck
npm test
npm run build
```

If you change a user journey, also run the browser tests. Please keep changes beginner-friendly and preserve the clear distinction between free picks and gambling.