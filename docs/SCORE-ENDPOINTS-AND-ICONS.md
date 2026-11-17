# Score endpoints and interface reference

## Running in COWBOY

| Endpoint | Use | HTTP time on November 16, 2026 |
| --- | --- | --- |
| [ESPN NFL scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) | Example of the shared primary scoreboard family under `/apis/site/v2/sports/{sport}/{competition}/scoreboard`. | HTTP 200, 119–240 ms |
| [ESPN NBA scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard) | Same family for basketball. Game Center uses `/{sport}/{competition}/summary?event={id}` where supported. | HTTP 200, 121–249 ms |
| [NHL daily scores](https://api-web.nhle.com/v1/score/2026-11-16) | Independent hockey fallback. Merges scores only into a matching scheduled event. | HTTP 200, 87–128 ms |
| [MLB date schedule with line scores](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-16&hydrate=team,linescore) | Independent baseball fallback. The test date returned no MLB games. | HTTP 200, 210–254 ms |

Each range uses three direct GETs from the development machine. These measurements are network and HTTP response times. Measuring event-to-screen delay requires a source event timestamp and a recorded client render timestamp. The current foreground polling target is 1.5 seconds for live games. Independent fallback coverage is hockey and MLB. Where supported, up to two known live team games per league can also recover through the primary provider's per-game summary during a scoreboard outage. Backup results are display-only. Pick entry and settlement still require the primary verification path.

## Team schedules

Game Center requests `/api/sports/team-schedule?league={league}&team={id}` when a viewer opens the Schedule tab. The server calls the [team schedule endpoint](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/2/schedule) using the league’s configured sport path and a numeric team ID. It verifies the returned team and game participants before caching the result for 60 seconds. The UI prefers current scoreboard data for games present in both responses and uses the scoreboard alone when the schedule is unavailable. Schedule cards show published TV or streaming network names, with the reported region when present.

## Lower-latency option

- The [NFL Push Feeds](https://developer.sportradar.com/football/docs/nfl-ig-push) publish game events and include a lightweight score-and-clock stream. The [Soccer Push Events](https://developer.sportradar.com/soccer/reference/soccer-push-events) support live event subscriptions. [NBA](https://developer.sportradar.com/basketball/reference/nba-push-events), [WNBA](https://developer.sportradar.com/basketball/reference/wnba-push-events), and [men’s college basketball](https://developer.sportradar.com/basketball/reference/ncaamb-push-events) have documented event streams. Production use requires credentials and coverage for each competition. These streams are candidates for a server-side subscriber and have not been enabled or timed in COWBOY.
- The [NBA live CDN scoreboard](https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json) returned HTTP 403 on all three checks. It is excluded from runtime fallback.
- Track provider event time, ingestion time, and client render time separately when integrating push. On reconnect, reconcile with a current REST snapshot, then apply updates by event identity and sequence. Keep the current polling path available during stream outages.

## Icon and navigation references

| Local archive | Applied to COWBOY |
| --- | --- |
| `SAHAND/sites/WEBSITE SCRAPES/Fanduel/www.fanduel.com/research/_next/` and `SAHAND/reference-captures/codex-browser-sportsbooks/expanded/offline/page-bb4fae12dde247bb.html` | FanDuel's rendered NFL capture contains the sport-category strip, a selected tab treatment, magnifier, chevrons and a dedicated live marker. Use the same visual hierarchy in COWBOY's sport rail, action buttons and live status. |
| `SAHAND/sites/BetMGM/BETMGM/www.betmgm.com/ClientDist/browser/` and `SAHAND/reference-captures/codex-browser-sportsbooks/expanded/offline/betmgm-live.html` | BetMGM's saved sports icon fonts, Live stylesheet, rendered menu and match accordions show compact category glyphs and adjacent labels. Apply that treatment to event-status, Live board, Game Center and My Picks tabs. |

The app uses hand-drawn SVG paths with COWBOY colors. Several COWBOY-specific tabs, including My Pick and the free-pick statuses, use corresponding sports or status symbols where the archives have no equivalent. The original HTML/CSS/JS and icon fonts remain in the reference archive.
