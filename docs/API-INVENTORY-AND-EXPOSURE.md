# API Inventory, Availability & Exposure Audit

**Audited:** 2026-11-20 05:39–06:10 UTC (2026-11-19 evening local)  
**Scope:** `COWBOY-github` frontend, `sites/cowboy` canonical gateway, `sites/sources-for cowboy` second gateway, Supabase account/sports schema.  
**Method:** static inventory, live `curl`/Node probes from this macOS host (US IP), production checks against `betcowboy.vercel.app`, and code review. Keyed APIs were probed without keys; one deliberately invalid key was used locally to test error redaction. No FanDuel/DraftKings scrape, geo-bypass, or bot-protection bypass was attempted.

> **Reading the labels:** ✅ works from this host · ⚠️ works with a caveat · 🔑 requires a key · 💤 returns no usable data · ⛔ blocked/dead · ❓ unverified.  
> “Free” means no paid key. It does **not** mean licensed for commercial use. ESPN, LiveScore, TheSportsDB, and the prediction-market APIs are unofficial or public-read services; review their terms before production use. Odds are display-only reference context; COWBOY remains free-to-play.

---

## 0. TL;DR

1. **The frontend is self-contained and has no public-secret leak.** It calls 9 upstream hosts and exposes 18 Next.js route files. No provider key or Supabase service key was found in the public JavaScript bundle.
2. **The old production 404 finding is stale.** As of 2026-11-20 05:39 UTC, `/api/sports/futures`, `/api/sports/props`, `/api/sports/news`, `/api/sports/market`, and `/api/picks/consensus` all resolve. The four content routes return **200**; `/api/picks/consensus` returns **409** because account/pick storage is unavailable.
3. **The current production failure is storage, not routing.** `/api/picks`, `/api/picks/consensus`, `/api/account/export`, and `/api/account/follows` return `409 service_unavailable`. `/api/account` returns `200 {"user":null}`. The local `.env.local` has a real Supabase service key, but the deployed environment is unverified.
4. **Free/keyless sources that actually work:** ESPN (scores, odds, props, news, stats), MLB Stats API, NHL API, NBA (Node fetch with browser headers), OpenLigaDB, LiveScore, Kalshi, Polymarket, PredictIt, Matchbook, Smarkets, Manifold, ScoreBat, Sleeper, OpenF1, Jolpica, Football-data CSV, SportScore, and football-data.org competitions.
5. **Free-with-key sources:** The Odds API (free tier), API-Football (free tier), and TheSportsDB premium. **Paid:** SportsDataIO, Sportradar, Sportmonks, MySportsFeeds, balldontlie paid tiers, TheRundown/RapidAPI, OddsJam, Sportsgrid, SportsInsights.
6. **Blocked/dead from this host:** FanDuel, DraftKings, BetMGM (HTTP 200 but empty), Caesars, PointsBet, BetRivers, Unibet, Pinnacle, Betfair, SofaScore, ActionNetwork, BettingPros, TheLines, Yahoo, FOX, CBS, Sportsgrid, SportsInsights, Metaculus. Details in §7.
7. **Critical exposure — gateway key echo.** The gateway serializes provider error strings into `attempts`. `HttpError` includes the full upstream URL, and The Odds API key is a query parameter. A local test with a fake key returned the key in the JSON response. The second gateway on `:8787` has a real `ODDS_API_KEY` and is therefore at risk. See §8.1.
8. **High exposure — second gateway.** `sites/sources-for cowboy` listens on all interfaces (`*:8787`), sets `access-control-allow-origin: *`, has no authentication or rate limit, and has real Odds API + Supabase keys in `.env` (mode `644`). It also exposes five stub routes that return misleading data. See §8.2–§8.4.
9. **Data-quality warning.** The canonical gateway returns a Kalshi “NBA Europe announcement” market as `basketball:nba` odds, not an NBA game market. MLB odds were empty in the sample (off-season). Do not wire the gateway into the board without filtering/validation.
10. **Recommended order:** secure/retire the second gateway → redact gateway errors and rotate the Odds API key → bind the gateway to loopback → fix production Supabase storage → add edge rate limits to public read APIs → only then decide whether to wire the canonical gateway.

---

## 1. Surface map

| Surface | Entry points | Public? | Authentication | Notes |
|---|---|---:|---|---|
| Next.js API | 18 route files, 24 methods | Mixed | Public reads; mutations require same-origin + session cookie | No CORS headers; CSP `connect-src 'self'`; production deployed on Vercel |
| `sites/cowboy` gateway | 7 GET routes | Yes, if exposed | None | 14 providers; 31 sports; 369 leagues; 137 markets; CORS `*`; no rate limit |
| `sites/sources-for cowboy` gateway | 12 GET routes | Yes, if exposed | None | 17 providers; 178 leagues; adds local FanDuel/BetMGM scrapes + Supabase sink; real keys; CORS `*` |
| Supabase account backend | RPCs under `/rest/v1/rpc/*` | No (service role) | Service-role key server-side | RLS enabled on account tables; no policies; service role bypasses |
| Supabase sports schema | `sports_data.*` | Unverified | Anon key used by second gateway | Schema/RLS not in repo migrations; docs claim policies; sync sink appears dead |
| Upstream sports APIs | 9 hosts used by frontend | Third-party | None / test key | See §2 |

### 1.1 Repository state at audit time

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD / `origin/main` | `322df9f fix: add odds tab icon required by Game Center` (in sync) |
| Unit tests | **175 pass / 0 fail** (`npm test`) |
| Typecheck | **passes** (`npm run typecheck`) |
| Production | Content routes 200; account/pick storage 409 |
| Uncommitted | 6 modified files + 2 new docs (this audit and the gap-closure handoff) |

The gap-closure handoff was written when HEAD was `78d3b1c`, typecheck was failing, and five routes returned 404. Those facts are no longer current; §1.4/§1.5 of `docs/HANDOFF-TOP6-GAP-CLOSURE.md` have been updated to point here.

---

## 2. Frontend upstream APIs (direct calls)

These are the only external hosts the frontend calls at runtime. No client component calls a paid provider or the gateway.

| Provider | Host / endpoint | Used for | Auth | Status | Evidence / caveat |
|---|---|---|---|---|---|
| ESPN site | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard` | Board, event detail, team schedule, news, rosters | None | ✅ | 200, `application/json`, ~0.12–0.23 s. Primary source. Embeds DraftKings odds in some events. |
| ESPN summary | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={id}` | Boxscore, props, plays, lineups | None | ✅ | 200, ~0.12 s. |
| ESPN core | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds?limit=50` | Market reference (moneyline/spread/total) | None | ✅ | 200, ~0.15 s. |
| ESPN core props | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds/100/propBets?limit=250` | Player props | None | ✅ | 200, ~0.28 s. Book is DraftKings via ESPN. |
| MLB Stats API | `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={date}&hydrate=team,linescore` | MLB scores/status | None | ✅ | 200, ~0.18 s. Official. |
| NHL API | `https://api-web.nhle.com/v1/score/{date}` | NHL scores/status | None | ✅ | 200, ~0.06 s. Official. |
| OpenLigaDB | `https://api.openligadb.de/getmatchdata/{league}` | German soccer fallback | None | ✅ | 200, ~0.52 s. Official open data. |
| LiveScore | `https://prod-public-api.livescore.com/v1/api/app/date/soccer/{YYYYMMDD}/{page}` | Soccer fallback | None | ✅ | 200, ~0.31 s. Unofficial/public. |
| TheSportsDB | `https://www.thesportsdb.com/api/v1/json/{key}/eventsday.php?d={date}&s={sport}` | Last-resort soccer fallback | Test key `123` | ⚠️ | 200, ~0.14 s. The `123` key is a public test key, rate-limited; not for production/commercial use. |
| Kalshi | `https://api.elections.kalshi.com/trade-api/v2/events` and `/markets` | Futures/outright boards | None | ✅ | 200, ~0.14 s. Public read; prediction market, not a sportsbook. |
| SportScore | `https://sportscore.com/api/widget/matches/?sport=football&limit=20` and `/match?slug=…` | Showcase page only | None | ✅ | 200, ~0.27 s; detail 200 ~0.34 s. Third-party widget; cached 60 s. Not a core feed. |

**Frontend safety notes**

- The frontend does **not** call The Odds API, API-Football, SportsDataIO, or any gateway route.
- `sportscore.com` is used only by `app/api/showcase/matches*`; it is not a board/odds source.
- `www.espn.com`, `www.nhl.com`, `www.mlb.com`, `www.livescore.com`, `www.openligadb.de`, and `www.thesportsdb.com` also appear as referers/links, not as data fetches.
- The `api.jolpi.ca` and `openf1.org` references found in gateway sources are not used by the frontend.

---

## 3. Next.js API routes

All routes are same-origin only: production API responses carry **no `Access-Control-Allow-Origin`** header, and the CSP is `connect-src 'self'`. The root HTML response carries an unrelated `access-control-allow-origin: *`; the API routes do not.

| Route | Methods | Auth | Cache | Production status | Upstream / purpose |
|---|---|---|---:|---|---|
| `/api/sports` | GET | Public | `no-store` | ✅ 200, ~0.19 s | ESPN, MLB, NHL, LiveScore, OpenLigaDB, TheSportsDB. Board. |
| `/api/sports/event` | GET | Public | `no-store` | ✅ 200, ~0.80 s, 89 KB | ESPN summary; validated league + numeric event ID. |
| `/api/sports/team-schedule` | GET | Public | `no-store` | ✅ 200, ~0.13 s | ESPN team schedule; validated numeric team ID. |
| `/api/sports/futures` | GET | Public | `public, max-age=60` | ✅ 200, ~0.10 s | Kalshi. Returns `{futures}`; catches provider failure as `null`. |
| `/api/sports/props` | GET | Public | `public, max-age=60` | ✅ 200, ~0.12 s | ESPN `propBets`; returns `{props}`; failure → `null`. |
| `/api/sports/news` | GET | Public | `public, max-age=60` | ✅ 200, ~0.09 s | ESPN news. |
| `/api/sports/market` | GET | Public | `public, max-age=60` | ✅ 200, ~0.68 s | ESPN odds → vig-free implied probabilities. |
| `/api/picks/consensus` | GET | Public by design | `public, max-age=30` | ⛔ 409 `service_unavailable` | Aggregated anonymous counts; requires storage. Fails closed. |
| `/api/account` | GET, POST, DELETE | GET public (returns `null`); POST/DELETE same-origin | `private, no-store` | GET 200 `{"user":null}` | Register/login/logout; HttpOnly `cowboy_session` cookie. |
| `/api/account/export` | GET | Session | `private, no-store` | ⛔ 409 `service_unavailable` | Exports only the requesting account’s public data. |
| `/api/account/follows` | GET, PATCH | GET session; PATCH same-origin | `private, no-store` | GET 409; PATCH 400 without Origin | Follow preferences. |
| `/api/account/sessions` | POST | Same-origin + session | `private, no-store` | 400 without Origin; GET 405 | Revoke other sessions. |
| `/api/account/delete` | DELETE | Same-origin + session + password | `private, no-store` | 400 without Origin | Deletes owner, sessions, picks. |
| `/api/picks` | GET, POST, PATCH, DELETE | GET session; mutations same-origin + session | `private, no-store` | GET 409; mutations 400 without Origin | List/submit/edit/cancel picks. |
| `/api/picks/batch` | POST | Same-origin + session | `private, no-store` | 400 without Origin | Multi-game entry. |
| `/api/picks/refresh` | POST | Same-origin + session | `private, no-store` | 400 without Origin | Re-grade open picks. |
| `/api/showcase/matches` | GET | Public | `s-maxage=60` | ✅ 200, ~0.11 s | SportScore widget matches. |
| `/api/showcase/matches/[slug]` | GET | Public | `s-maxage=60` | ✅ 200 valid; 502 invalid/upstream | Slug regex `^[a-z0-9-]{2,120}$`; no SSRF. |

**Production timing evidence (2026-11-20 05:39 UTC):**

```
/api/sports                              200  0.19s
/api/sports/event?league=nba&id=401910019 200  0.80s
/api/sports/team-schedule?league=nba&team=13 200 0.13s
/api/sports/futures?league=nba            200  0.10s
/api/sports/props?league=nba&id=401910019 200  0.12s
/api/sports/news?league=nba               200  0.09s
/api/sports/market?league=nba&id=401910019 200 0.68s
/api/picks/consensus                      409  0.11s
/api/account                              200  0.13s
/api/picks                                409  0.12s
/api/account/export                       409  0.14s
/api/account/follows                      409  0.12s
/api/showcase/matches                     200  0.11s
```

**Mutation protection (verified):**

```
OPTIONS /api/picks                        204 (no ACAO)
POST    /api/picks          no Origin     400 cross_origin
POST    /api/account        no Origin     400 cross_origin
POST    /api/picks/refresh  no Origin     400 cross_origin
POST    /api/picks/batch    no Origin     400 cross_origin
DELETE  /api/picks?id=x     no Origin     400 cross_origin
PATCH   /api/account/follows no Origin    400 cross_origin
DELETE  /api/account/delete no Origin     400 cross_origin
POST    /api/account/sessions no Origin   400 cross_origin
```

The cross-origin check compares `Origin` to `Host` and the forwarded protocol, rejects `Origin: null` and `Sec-Fetch-Site: cross-site`, and is backed by a session cookie with `HttpOnly; SameSite=Strict; Secure` in production. Mutation bodies are capped at 4 KB and limited to an explicit field list. Rate limits are in-memory per process (`MutationLimiter`), not durable across Vercel instances.

---

## 4. Gateway APIs

### 4.1 Canonical gateway — `sites/cowboy`

**Inventory:** 14 providers, 31 sports, 369 leagues, 137 market definitions. The frontend never calls it.

| Route | Status | Notes |
|---|---|---|
| `GET /health` | ✅ 200 | Provider readiness + per-host cooldown/inflight/last-request. No keys, but exposes host timings. |
| `GET /api/sports` | ✅ 200 | 31 sports with league/market counts and provider coverage. |
| `GET /api/leagues?sport=` | ✅ 200 | 369 total; 6 basketball. |
| `GET /api/markets?sport=&category=` | ✅ 200 | 137 total; category-filtered. |
| `GET /api/games?league=&date=&live=&limit=` | ✅ 200 | NBA via `nba`; NFL/EPL/MLB/NHL via `espn`. |
| `GET /api/odds?league=&date=&eventId=&marketType=&limit=` | ⚠️ 200 | NFL/EPL/NHL return ESPN/DraftKings. NBA returned a Kalshi futures event, not a game market. MLB empty in sample. |
| `GET /api/stats?league=&gameId=&provider=` | ✅ 200 | ESPN boxscore for NBA sample. |

**Live checks:**

```
/api/games?league=basketball:nba  200  provider=nba
/api/games?league=football:nfl    200  provider=espn
/api/games?league=soccer:epl      200  provider=espn
/api/games?league=baseball:mlb    200  provider=espn
/api/games?league=hockey:nhl      200  provider=espn
/api/odds?league=football:nfl     200  provider=espn, book=DraftKings
/api/odds?league=soccer:epl       200  provider=espn, book=DraftKings
/api/odds?league=hockey:nhl       200  provider=espn, book=DraftKings
/api/odds?league=basketball:nba   200  provider=kalshi, event=KXNBAEUROPEANNOUNCE-26
/api/odds?league=baseball:mlb     200  0 items
/api/stats?league=basketball:nba  200  provider=espn
```

**Exposure:** `access-control-allow-origin: *` on every response, no auth, no rate limit, `server.listen(PORT)` binds all interfaces. It is a local research server, not a production edge.

### 4.2 Second gateway — `sites/sources-for cowboy`

**Inventory:** 17 providers (adds `fanduel`, `betmgm`, `supabase` to the canonical 14), 178 leagues, 137 markets. It is a divergent copy, not the canonical gateway.

**Extra routes and their real behavior:**

| Route | Real behavior | Verdict |
|---|---|---|
| `GET /api/sports` | **404**, even though the 404 body lists it as a route. | ⛔ Missing route. |
| `GET /api/sports/futures` | Calls `sportsRouter.games(...)` without `await`, so the response serializes to `{}`. | ⛔ Stub/broken. |
| `GET /api/markets/futures` | Requires `?league=`, not `?sport=`; returns `odds` with `marketType=futures`. | ⚠️ Misnamed; works only with a league. |
| `GET /api/markets/player_props` | Requires `?league=`; returns `player_points` odds. | ⚠️ Misnamed; works only with a league. |
| `GET /api/news` | Returns the league catalog, not news articles. | ⛔ Stub. |
| `GET /api/picks/consensus` | Returns `games`, not consensus counts. | ⛔ Stub. |

The five extra routes are not production features. Do not wire them or document them as delivered.

**Exposure:** same CORS `*`, no auth, no rate limit, all-interface bind. It also has real `ODDS_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, and `SCRAPES_ROOT` in `.env`. See §8.

### 4.3 Gateway route behavior summary

| Need | Canonical gateway | Second gateway |
|---|---|---|
| Scores | ✅ `/api/games` | ✅ `/api/games` |
| Odds | ⚠️ ESPN for NFL/EPL/NHL; NBA wrong; MLB empty | ⚠️ Same base behavior; real Odds API key present but circuit-open in sample |
| Stats | ✅ `/api/stats` | ✅ `/api/stats` |
| Futures | ❌ no route | ⛔ broken `{}` |
| Props | ❌ no route | ⚠️ `/api/markets/player_props?league=` |
| News | ❌ no route | ⛔ returns leagues |
| Consensus | ❌ no route | ⛔ returns games |
| Sports catalog | ✅ `/api/sports` | ⛔ 404 |

---

## 5. Gateway provider inventory

| ID | Kind | Capabilities | Key / env | Base host | Live status | Notes |
|---|---|---|---|---|---|---|
| `espn` | free-unofficial | games, odds, stats | none | `site.api.espn.com`, `sports.core.api.espn.com` | ✅ | Primary; embeds DraftKings/Bet365 odds. |
| `nba` | official-free | games, stats | none | `stats.nba.com`, `cdn.nba.com` | ✅ via Node | Akamai: `curl` gets 403/timeout; Node fetch with `referer`/`origin` gets 200. |
| `mlb` | official-free | games, stats | none | `statsapi.mlb.com` | ✅ | Official. |
| `nhl` | official-free | games, stats | none | `api-web.nhle.com`, `api.nhle.com` | ✅ | Official. |
| `oddsapi` | freemium | games, odds | `ODDS_API_KEY` | `api.the-odds-api.com/v4` | 🔑 | 401 without key; free tier ~500 credits/month. Key is in the query string. |
| `matchbook` | exchange | odds | none | `api.matchbook.com/edge/rest` | ✅ | Public read; exchange terms apply. |
| `livescore` | free-unofficial | games | none | `prod-public-api.livescore.com` | ✅ | Soccer only. |
| `sportsdb` | freemium | games | `SPORTSDB_KEY` (default `123`) | `www.thesportsdb.com/api/v1/json` | ⚠️ | Test key only; rate-limited. |
| `openligadb` | official-free | games | none | `api.openligadb.de` | ✅ | German football. |
| `apifootball` | freemium | games, stats | `API_FOOTBALL_KEY` | `v3.football.api-sports.io` | 🔑 | 403 without key; free tier ~100 requests/day. Key is a header. |
| `sportsdataio` | paid | games, odds | `SPORTSDATAIO_KEY` | `api.sportsdata.io/v3` | 🔑 | 401 without key; paid/trial. Key is a header. |
| `kalshi` | exchange | odds | none | `api.elections.kalshi.com/trade-api/v2` | ✅ | Public read; futures/outrights. Mis-maps NBA futures as game odds in the sample. |
| `polymarket` | exchange | odds | none | `gamma-api.polymarket.com` | ✅ | Public read; play-money/prediction markets. |
| `predictit` | exchange | odds | none | `www.predictit.org/api/marketdata/all/` | ✅ | Public politics markets. |
| `fanduel` | free-unofficial | games | none | local scrape only | 💤 | No network URL; offline fallback. Live endpoints are DNS/PerimeterX-blocked. Do not scrape. |
| `betmgm` | free-unofficial | games | none | local scrape only | 💤 | Offline fallback; live widget returns 200 with an empty body. |
| `supabase` | sync sink | games, odds, stats | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | project URL from env | 💤 | `getGames/getOdds/getStats` return empty; `syncGames/syncOdds/syncStats` are defined but never called. `/health` says ready, but it does not sync. |

**Key handling:**

- `oddsapi` appends `apiKey` to the query string. This is the source of the leak in §8.1.
- `apifootball` and `sportsdataio` send keys in headers; safer.
- `sportsdb` puts the key in the path; a real key would leak the same way if errors are serialized.
- `fanduel`/`betmgm` read local files under `SCRAPES_ROOT`; they are not live APIs and should not be represented as fresh.

---

## 6. Free vs keyed vs paid

### 6.1 Free/keyless sources that work

| Source | What it gives | Used by | Caveat |
|---|---|---|---|
| ESPN site/core | Scores, odds, props, news, stats, rosters | Frontend + gateway | Unofficial; embedded DraftKings odds; rate-limit/pacing needed. |
| MLB Stats API | MLB scores, live feed, stats | Frontend + gateway | Official; free. |
| NHL API | NHL scores, stats | Frontend + gateway | Official; free. |
| NBA official | NBA scoreboard, boxscore, stats | Gateway | Akamai risk; Node fetch with browser headers works; `curl` does not. |
| OpenLigaDB | German soccer results | Frontend + gateway | Official open data; limited leagues. |
| LiveScore | Soccer scores | Frontend + gateway | Unofficial/public; soccer only. |
| Kalshi | Futures/outright markets | Frontend + gateway | Public read; prediction market, not sportsbook odds; filter by league/event. |
| Polymarket | Prediction markets | Gateway | Public read; not sportsbook odds. |
| PredictIt | Politics markets | Gateway | Public read; not sports. |
| Matchbook | Exchange odds | Gateway | Public read; exchange terms. |
| Smarkets | Exchange events | Unused | Public read; needs market/contract endpoints for prices. |
| Manifold | Play-money markets | Unused | Public read; play money. |
| ScoreBat | Highlights/scores | Unused | Free; video/highlight focus. |
| Sleeper | NFL state/players | Unused | Free; NFL only. |
| OpenF1 | F1 sessions/telemetry | Unused | Free; F1 only. |
| Jolpica F1 | Ergast-compatible F1 | Unused | Free; F1 standings/results. |
| Football-data CSV | Historical soccer CSV | Unused | Free; historical, not live. |
| SportScore | Showcase widget | Frontend showcase | Third-party widget; not a core feed. |
| football-data.org | Competition catalog | Unused | `200` without key for `/competitions`; free tier/rate limits; key recommended. |
| Flashscore | Soccer feed token | Unused | ⚠️ Probe returned 200 with a token; direct request today returned 401. Treat as token-gated/fragile. |

### 6.2 Free with a key

| Source | Free tier | Key env | Status |
|---|---|---|---|
| The Odds API | ~500 credits/month | `ODDS_API_KEY` | 401 without key. Real key present in second gateway `.env`; circuit-open in sample. |
| API-Football | ~100 requests/day | `API_FOOTBALL_KEY` | 403 without key. |
| TheSportsDB | Public test key `123`; premium tiers | `SPORTSDB_KEY` | 200 with test key; not production-licensed. |

### 6.3 Paid

| Source | Key env | Status without key |
|---|---|---|
| SportsDataIO | `SPORTSDATAIO_KEY` | 401 |
| Sportradar | `SPORTRADAR_KEY` (not in gateway) | 403 |
| Sportmonks | `SPORTMONKS_KEY` (not in gateway) | 401 |
| MySportsFeeds | `MYSPORTSFEEDS_KEY` (not in gateway) | 401 |
| balldontlie | `BALLDONTLIE_KEY` (not in gateway) | 401 |
| TheRundown / RapidAPI | `RAPIDAPI_KEY` (not in gateway) | 401 |
| OddsJam | `ODDSJAM_KEY` (not in gateway) | connection error |
| Sportsgrid | `SPORTSGRID_KEY` (not in gateway) | 404 |
| SportsInsights | `SPORTSINSIGHTS_KEY` (not in gateway) | 404 |

None of these paid keys are present in the canonical gateway or frontend. The second gateway has only `ODDS_API_KEY`.

---

## 7. Blocked / dead / unreliable

### 7.1 Hard-blocked or dead from this host

| Source | Result | Cause / note |
|---|---|---|
| FanDuel NJ/AZ | `0` (DNS/TLS) | PerimeterX/geo; direct access is off-limits. The local mirror is not an API. |
| DraftKings | `403` | Akamai/bot protection. Do not scrape. |
| BetMGM | `200` with empty body | Widget endpoint returns no usable JSON. |
| Caesars | `596` | Cloudflare/edge block. |
| PointsBet | `404` | Endpoint dead. |
| BetRivers | `0` | Connection failure. |
| Unibet | `404` | Endpoint dead. |
| Pinnacle | `451` | US geo-block. |
| Betfair | `403` | Needs app key + session. |
| SofaScore / SofaScore API | `403` | Bot protection. |
| ActionNetwork | `404` | Endpoint dead. |
| BettingPros | `403` | Blocked. |
| TheLines | `0` | Connection failure. |
| OddsPapi | `404` | Endpoint dead / key likely. |
| Yahoo Sports | `400` | Endpoint rejected. |
| FOX Sports | `401` | Endpoint rejected. |
| CBS Sports | `404` | Endpoint dead. |
| Sportsgrid | `404` | Endpoint dead. |
| SportsInsights | `404` | Endpoint dead. |
| Metaculus | `403` | Blocked. |

### 7.2 Works but not safe to depend on

| Source | Issue |
|---|---|
| NBA official | `curl` 403/timeout; Node fetch with `referer: https://www.nba.com/` and `origin: https://www.nba.com` works. Any client without those headers will fail. |
| TheSportsDB `123` | Public test key; rate-limited; not licensed for production. |
| Flashscore | Token/feed-gated; probe 200, direct 401 today. |
| Kalshi | Public read, but futures markets are not game odds; filter carefully. |
| SportScore | Third-party widget; availability/terms can change; showcase only. |
| Matchbook/Smarkets | Public read, but exchange terms and market/contract semantics apply. |

---

## 8. Exposure findings

### 8.1 P0 — Gateway echoes provider keys in `attempts`

**Confirmed with a fake key.** The gateway’s `HttpError` includes the full request URL, `RouterError` includes attempt error strings, and the server serializes `attempts` to the client. The Odds API key is appended as `apiKey` in the query string.

Local reproduction (fake key only; do not use the real key):

```
PORT=8789 ODDS_API_KEY=invalid-test-key-12345 npm run serve
GET /api/odds?league=basketball:nba&marketType=moneyline&limit=1
```

Observed response (redacted):

```json
{
  "provider": "kalshi",
  "attempts": [
    {
      "provider": "oddsapi",
      "status": "error",
      "error": "HTTP 401 for https://api.the-odds-api.com/v4/sports/basketball_nba/odds?...&apiKey=<redacted>"
    }
  ]
}
```

The fake key was present verbatim in the response. The real gateway on `:8787` has a real 28-character `ODDS_API_KEY`; its `oddsapi` attempt was `circuit-open` during the sample, so the key was not observed live, but the code path is active.

**Fix**

1. Redact query strings and credentials from `HttpError` messages; store only `status`, `host`, and a safe path.
2. Never serialize raw `attempts[].error` to clients. Return `{provider, status, ms}` only.
3. Prefer a header for provider keys where supported; for The Odds API, redaction is mandatory.
4. Rotate the Odds API key if the gateway has ever been reachable beyond loopback.

### 8.2 P0 — Second gateway is open, unauthenticated, and has real keys

`sites/sources-for cowboy` is currently running on `*:8787` (confirmed with `lsof`). It sets:

```
access-control-allow-origin: *
access-control-allow-headers: content-type
```

There is no auth, no rate limit, and no origin allowlist. Its `.env` contains:

- `ODDS_API_KEY` — set, 28 chars.
- `SUPABASE_URL` — set.
- `SUPABASE_ANON_KEY` — set.
- `SUPABASE_PROJECT_REF` — set.
- `SCRAPES_ROOT` — set (local filesystem path).

The file is mode `644` and is not in a git repository, but it is readable by other local users and travels with the folder if it is zipped, copied, or deployed. Combined with §8.1, this is a live key-exposure path.

**Fix**

1. Stop the second gateway, or bind it to `127.0.0.1` (`server.listen(PORT, '127.0.0.1')`).
2. If it must listen remotely, add a server-to-server token/auth check, an origin allowlist (not `*`), and rate limiting.
3. Rotate the Odds API key and Supabase anon key if the port was reachable from an untrusted network.
4. Remove the five stub routes or implement them correctly; do not advertise them.

### 8.3 P1 — Real Supabase service-role key on disk

`COWBOY-github/.env.local` contains:

- `COWBOY_SUPABASE_URL` — set, 40 chars.
- `SUPABASE_SERVICE_ROLE_KEY` — set, 219 chars.

The file is gitignored and mode `600`. A scan of `.next`, `public`, and `out` found no copy of the key value, and the public JavaScript bundle contains no `SUPABASE_SERVICE_ROLE_KEY`, `ODDS_API_KEY`, `API_FOOTBALL_KEY`, `SPORTSDATAIO_KEY`, `service_role`, or JWT markers. The deployed Vercel environment is unverified.

**Fix**

1. Keep the service-role key server-only; never expose it through `NEXT_PUBLIC_*`.
2. Rotate it if the workspace was shared, backed up insecurely, or copied into a build artifact.
3. Verify the Vercel production env separately; the 409s suggest the production backend is not configured or is failing.

### 8.4 P1 — Supabase function grants and `sports_data` RLS are not proven

**Account schema**

`supabase/migrations/20260714000000_cowboy_account_store.sql`:

- Enables RLS on `cowboy_users`, `cowboy_sessions`, and `cowboy_picks`.
- Adds **no policies**, so `anon`/`authenticated` get no table access; `service_role` bypasses RLS.
- Defines `security definer` functions with `search_path = public`.
- Does **not** explicitly `grant`/`revoke` function execution.

`cowboy_lookup_user(p_username_key)` returns `id`, `username`, `salt`, and `passwordHash`. `cowboy_require_user` returns the user row. If the default `PUBLIC`/`anon` execute grant is still in place, an anon-key holder could call these RPCs. The anon key is not in the frontend, but defense-in-depth requires revoking it.

**Fix**

```sql
revoke execute on function public.cowboy_lookup_user(text) from public, anon, authenticated;
revoke execute on function public.cowboy_require_user(text) from public, anon, authenticated;
-- Repeat for every cowboy_* RPC; grant only to service_role.
grant execute on function public.cowboy_lookup_user(text) to service_role;
```

Verify in the Supabase dashboard; do not assume the default grants.

**Sports schema**

The `sports_data` schema and its RLS policies are **not in the repo migrations**. `sites/sources-for cowboy/docs/COMPETITIVE-PARITY.md` claims:

- `authenticated` can read.
- `service_role` can write.

But the gateway uses `SUPABASE_ANON_KEY`, not a service key, and `syncGames`/`syncOdds`/`syncStats` are defined but never called. The docs claim the write path was verified; the code does not exercise it. Treat the sync sink as **unverified/dead** until proven with a real write and a read-back.

### 8.5 P1 — Public read APIs have no rate limit

`/api/sports`, `/api/sports/event`, `/api/sports/team-schedule`, `/api/sports/futures`, `/api/sports/props`, `/api/sports/news`, `/api/sports/market`, `/api/showcase/*`, and `/api/picks/consensus` are public. There is no edge/WAF rate limit in the repo. An attacker can:

- Force repeated ESPN/Kalshi/SportScore fetches and burn provider quota or trigger blocks.
- Use `/api/sports/event` (89 KB, multiple upstream calls) as an amplification target.
- Poll `/api/picks/consensus`; it is cheap but still public.

The frontend has internal pacing/coalescing and caches, but those are per-instance. Vercel’s edge cache helps only where `Cache-Control` allows it; `/api/sports` is `no-store`.

**Fix**

1. Add a Vercel WAF/rate-limit rule or an edge middleware token bucket per IP/session.
2. Keep `s-maxage`/`stale-while-revalidate` on futures/props/news/market/showcase.
3. Add a short shared cache for `/api/sports` (e.g., 5–15 s) if freshness allows.
4. Consider a server-to-server token for the gateway if it is ever wired.

### 8.6 P2 — Gateway `/health` and 404 metadata

`/health` exposes provider readiness and per-host `lastRequestAgoMs`, `inflight`, and `blockedRemainingMs`. This is useful for operators but not for the public. The 404 body lists routes; the second gateway’s list includes `/api/sports`, which is actually missing.

**Fix:** keep `/health` on loopback or behind auth; make the 404 list accurate.

### 8.7 P2 — Misleading gateway data

- `sites/cowboy` NBA odds: `KXNBAEUROPEANNOUNCE-26` (“When will NBA Europe’s inaugural season be announced?”) is returned as `basketball:nba` odds. That is a futures/prediction market, not a game moneyline. Filter Kalshi by league/event/team or restrict it to futures.
- `sites/cowboy` MLB odds: 0 items in the sample (off-season). Not necessarily a bug, but the UI must show “unavailable,” not fabricate.
- `sites/sources-for cowboy` `/api/sports/futures` returns `{}` because the async call is not awaited.
- `/api/news` returns leagues; `/api/picks/consensus` returns games. These are stubs, not features.

### 8.8 Positive controls (keep these)

- Next.js API responses have no `Access-Control-Allow-Origin`; same-origin only.
- Mutation routes require a matching `Origin`/`Host`, reject `Sec-Fetch-Site: cross-site`, and use `HttpOnly; SameSite=Strict; Secure` session cookies.
- Passwords use scrypt with a random salt; session tokens are 32 random bytes and stored as SHA-256 hashes.
- Mutation bodies are capped at 4 KB with explicit field allowlists.
- CSP: `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`; `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; HSTS via Vercel.
- Input validation: league allowlists, numeric event/team IDs, showcase slug regex; no arbitrary URL proxy.
- Account tables have RLS enabled; service-role key is server-side only.
- No provider key or service key in the public JS bundle.

---

## 9. Prioritized fix list

| Priority | Action | Why |
|---|---|---|
| P0 | Redact gateway error URLs and `attempts[].error`; return only provider/status/ms. | Confirmed key echo; prevents credential leakage. |
| P0 | Stop or loopback-bind `sites/sources-for cowboy`; add auth/CORS allowlist if remote. | Open, unauthenticated, all-interface gateway with real keys. |
| P0 | Rotate the Odds API key if `:8787` was reachable beyond loopback. | Assume compromise if exposed. |
| P1 | Verify/repair production Supabase storage; fix the 409s. | Picks, consensus, export, and follows are down in production. |
| P1 | Revoke `EXECUTE` on `cowboy_*` RPCs from `anon`/`authenticated`; grant only `service_role`. | `cowboy_lookup_user` returns salt + password hash. |
| P1 | Verify `sports_data` RLS and whether the anon key can write; fix the dead sync sink or remove it. | Docs claim verified; code does not call sync. |
| P1 | Add edge/WAF rate limits to public read routes. | Prevent quota burn and provider blocks. |
| P2 | Fix Kalshi league/event filtering; never show futures as game odds. | Data quality/trust. |
| P2 | Fix or remove the second gateway’s stub routes; fix `/api/sports` 404. | Misleading API surface. |
| P2 | Tighten `.env` permissions to `600`; remove the project URL from `.env.example` comments if not needed. | Reduce local exposure. |
| P2 | Update handoff/docs with current production status and counts. | Avoid stale instructions. |
| P3 | Decide gateway: wire the canonical `sites/cowboy` server-side or retire it. Do not merge the second gateway. | Avoid duplicate/divergent provider code. |

---

## 10. Reproduction

```bash
# Canonical gateway tests
cd sites/cowboy
npm test
npm run typecheck
PORT=8788 npm run serve
curl -sS http://127.0.0.1:8788/health | jq
curl -sS http://127.0.0.1:8788/api/sports | jq '.count'
curl -sS 'http://127.0.0.1:8788/api/games?league=basketball:nba&limit=2' | jq '.value[0]'
curl -sS 'http://127.0.0.1:8788/api/odds?league=football:nfl&marketType=moneyline&limit=2' | jq '.value[0]'

# Production route matrix
for p in /api/sports /api/sports/futures?league=nba /api/sports/props?league=nba\&id=401910019 \
         /api/sports/news?league=nba /api/sports/market?league=nba\&id=401910019 \
         /api/picks/consensus /api/account; do
  curl -sS -o /dev/null -w "$p %{http_code} %{time_total}\n" "https://betcowboy.vercel.app$p"
done

# Key-echo test — fake key only; never use the real key
cd sites/cowboy
PORT=8789 ODDS_API_KEY=invalid-test-key-12345 npm run serve
curl -sS 'http://127.0.0.1:8789/api/odds?league=basketball:nba&marketType=moneyline&limit=1' \
  | jq '.attempts' \
  | sed -E 's/(apiKey=)[^&" ]+/\1<redacted>/g'

# Full source probe (writes sources.json + probes/latest.json)
npm run probe:sources
```

The full probe dataset is in `sites/cowboy/sources.json` and `sites/cowboy/probes/latest.json` (probe date 2026-11-18). Today’s spot checks above were run on 2026-11-20 UTC. Re-run the probe before relying on any row; public APIs change without notice.

---

## Appendix A — Full probe table (65 sources, 2026-11-18)

`200` means the HTTP request succeeded, not that the payload is usable. `0` means a connection/DNS/TLS failure. Keyed sources were probed without keys; `401/403` is the expected failure mode.

| Group | Source | Status | Access | Note |
|---|---|---:|---|---|
| scores | `espn-site` | 200 | free | scoreboard + odds + summary |
| scores | `espn-core` | 200 | free | league/athlete/odds graph |
| scores | `mlb-statsapi` | 200 | free | official MLB |
| scores | `mlb-statsapi-live` | 200 | free | official live feed |
| scores | `nhl-api-web` | 200 | free | official NHL |
| scores | `nhl-api` | 200 | free | official NHL stats |
| scores | `thesportsdb` | 200 | free | test key `123`, rate-limited |
| scores | `openligadb` | 200 | free | official German football |
| scores | `nba-cdn` | 200 | free | NBA CDN live scoreboard |
| scores | `nba-stats` | 200 | free | official NBA stats (Akamai risk) |
| scores | `nba-boxscore` | 200 | free | NBA CDN boxscore + team stats |
| scores | `espn-summary` | 200 | free | ESPN boxscore, props, plays |
| scores | `livescore` | 200 | free | LiveScore public API |
| scores | `sofascore` | 403 | blocked | SofaScore risk |
| scores | `sofascore-api` | 403 | blocked | SofaScore direct API |
| scores | `flashscore` | 200 | free | feed token; direct 401 today |
| scores | `scorebat` | 200 | free | highlights + scores |
| scores | `sleeper-state` | 200 | free | NFL state |
| scores | `sleeper-players` | 200 | free | NFL players (large) |
| scores | `openf1` | 200 | free | F1 sessions/telemetry |
| scores | `jolpica-f1` | 200 | free | Ergast-compatible F1 |
| scores | `football-data-uk` | 200 | free | historical CSV |
| prediction | `kalshi` | 200 | free | public read, no key |
| prediction | `kalshi-events` | 200 | free | nested markets |
| prediction | `kalshi-series` | 200 | free | series catalog |
| prediction | `polymarket-gamma` | 200 | free | public gamma API |
| prediction | `polymarket-events` | 200 | free | events + nested markets |
| prediction | `polymarket-clob` | 200 | free | public CLOB |
| prediction | `manifold` | 200 | free | play-money markets |
| prediction | `predictit` | 200 | free | politics markets |
| prediction | `metaculus` | 403 | blocked | forecasting questions |
| sportsbook | `fanduel-nj` | 0 | blocked | DNS/TLS; do not scrape |
| sportsbook | `fanduel-az` | 0 | blocked | alternate state; do not scrape |
| sportsbook | `draftkings` | 403 | blocked | Akamai risk |
| sportsbook | `betmgm` | 200 | free | empty body; unusable |
| sportsbook | `caesars` | 596 | blocked | Cloudflare/edge |
| sportsbook | `pointsbet` | 404 | dead | endpoint dead |
| sportsbook | `betrivers` | 0 | blocked | connection failure |
| sportsbook | `unibet` | 404 | dead | endpoint dead |
| sportsbook | `smarkets` | 200 | free | exchange public read |
| sportsbook | `matchbook` | 200 | free | exchange public read |
| sportsbook | `matchbook-sports` | 200 | free | 49 sport IDs |
| sportsbook | `matchbook-soccer` | 200 | free | soccer odds |
| sportsbook | `pinnacle` | 451 | blocked | US geo-block |
| sportsbook | `betfair` | 403 | blocked | needs app key + session |
| sportsbook | `actionnetwork` | 404 | dead | endpoint dead |
| sportsbook | `bettingpros` | 403 | blocked | bot protection |
| sportsbook | `thelines` | 0 | dead | connection failure |
| sportsbook | `oddspapi` | 404 | dead | endpoint dead / key likely |
| keyed | `the-odds-api` | 401 | keyed | expected without key |
| keyed | `api-football` | 403 | keyed | expected without key |
| keyed | `sportsdataio` | 401 | keyed | expected without key |
| keyed | `sportsdataio-props` | 401 | keyed | expected without key |
| keyed | `sportradar` | 403 | keyed | expected without key |
| keyed | `sportmonks` | 401 | keyed | expected without key |
| keyed | `balldontlie` | 401 | keyed | expected without key |
| keyed | `football-data-org` | 200 | keyed | competitions work without key; free tier |
| keyed | `mysportsfeeds` | 401 | keyed | expected without key |
| keyed | `therundown` | 401 | keyed | RapidAPI key |
| keyed | `oddsjam` | 0 | keyed | connection failure |
| keyed | `sportsgrid` | 404 | keyed | endpoint dead |
| keyed | `sportsinsights` | 404 | keyed | endpoint dead |
| editorial | `yahoo-sports` | 400 | blocked | endpoint rejected |
| editorial | `fox-sports` | 401 | blocked | endpoint rejected |
| editorial | `cbs-sports` | 404 | dead | endpoint dead |

**Probe counts:** 65 total · 34 HTTP 200 · 31 failed. Of the 34 “200” rows, BetMGM is empty, Flashscore is token-gated, football-data.org is keyed/free-tier, and TheSportsDB uses a test key. Treat the usable-free count as lower than 34.

---

## Appendix B — Environment and secret inventory

| Key | Where | Set? | Tracked? | Public bundle? | Notes |
|---|---|---:|---:|---:|---|
| `ODDS_API_KEY` | `sites/sources-for cowboy/.env` | Yes (28 chars) | No git repo | No | Query-string key; exposed by §8.1. Rotate if reachable. |
| `ODDS_API_KEY` | `sites/cowboy/.env` | Empty | Gitignored | No | Canonical gateway has no key. |
| `API_FOOTBALL_KEY` | both gateways | Empty | Gitignored | No | Keyed provider skipped. |
| `SPORTSDATAIO_KEY` | both gateways | Empty | Gitignored | No | Keyed provider skipped. |
| `SPORTSDB_KEY` | both gateways | `123` test | Gitignored | No | Public test key. |
| `SUPABASE_URL` | `sites/sources-for cowboy/.env` | Yes | No git repo | No | Second gateway. |
| `SUPABASE_ANON_KEY` | `sites/sources-for cowboy/.env` | Yes (46 chars) | No git repo | No | Used for `sports_data` writes; verify RLS. |
| `SUPABASE_PROJECT_REF` | `sites/sources-for cowboy/.env` | Yes | No git repo | No | Project identifier. |
| `SCRAPES_ROOT` | `sites/sources-for cowboy/.env` | Yes | No git repo | No | Local filesystem path; not a secret, but avoid error leakage. |
| `COWBOY_SUPABASE_URL` | `COWBOY-github/.env.local` | Yes | Gitignored | No | Local only; production env unknown. |
| `SUPABASE_SERVICE_ROLE_KEY` | `COWBOY-github/.env.local` | Yes (219 chars) | Gitignored | No | Server-only; rotate if workspace shared. |
| `NEXT_PUBLIC_APP_URL` | `app/layout.tsx` | Optional | N/A | Yes (URL only) | Not a secret. |
| `NEXT_PUBLIC_SUPABASE_URL` | `app/lib/supabase-store.ts` fallback | Optional | N/A | No | Only the URL; service key is separate. |

No `NEXT_PUBLIC_*` provider key is used. The public bundle scan covered the page HTML and all `_next/static/chunks/*.js` referenced by it; it found no key markers, no `service_role`, no JWT, and no Supabase project URL.

---

## Appendix C — What to tell the IDE

- Do **not** expose either gateway. If the gateway is wired, proxy it server-side from Next.js and keep the provider keys in the server environment.
- Do **not** merge `sites/sources-for cowboy` into `sites/cowboy`. It is a divergent copy with stub routes and local scrape fallbacks.
- Do **not** treat the Kalshi NBA futures market as game odds; filter by league/event/team.
- Do **not** trust the second gateway’s futures/news/consensus routes; they are stubs.
- Do **not** add FanDuel/DraftKings scraping; the live endpoints are blocked and the local mirror is not an API.
- **Do** fix the production Supabase storage 409s before claiming picks are production-ready.
- **Do** add rate limits to public read routes and redact gateway errors.
- **Do** re-run `npm test`, `npm run typecheck`, and `npm run probe:sources` before shipping.

---

*End of audit. Evidence was collected from this host on 2026-11-20 UTC; public APIs and production deployments can change. Re-run the reproduction commands before relying on any status.*
