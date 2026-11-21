# COWBOY reference and coverage evidence

## Reference comparison

The saved 1280 × 720 FanDuel and DraftKings captures both show Chargers at Ravens before kickoff. FanDuel gives the matchup a separate heading and presents expandable groups below category controls. DraftKings shows neighboring matchups above the main scoreboard and puts detail categories below it. COWBOY acceptance is a persistent matchup score and phase, independently scrollable detail, and return to the originating card and filter. Screenshots establish visible layout. Switch, dismissal, and focus behavior on the references are unverified.

| Reference | Evidence reviewed | Remaining check |
|---|---|---|
| FanDuel | `reference-captures/codex-browser-sportsbooks/fanduel-game` browser capture. The `website-captures/fanduel` crawl reached a transfer cap. | Live game switching and mobile Back |
| DraftKings | `reference-captures/codex-browser-sportsbooks/draftkings-game` browser capture. The `website-captures/draftkings` crawl received HTTP 403. | Sport, league and date navigation on mobile |
| BetMGM, bet365, Fanatics | Local extracts are static evidence. The `website-captures/fanatics` crawl reached a transfer cap. | Event groups, tracker and preview selection flows |
| Flashscore, theScore | Runtime unverified. | Match data depth, Following, and alerts |

All vendor files reviewed are reference-only. COWBOY uses its existing assets and components.

## Sport capability register

These rows describe implementation surfaces and remaining proof. Support varies by league and matchup.

| Sport | Existing COWBOY surface | Coverage or verification still needed |
|---|---|---|
| Football | Possession and field position, drives, scoring plays, leaders and play-by-play | Android journey and timestamped official live comparison |
| Basketball | Period score, progression, team stats and player box score | Real live and final samples by league |
| Hockey | Period score, timeline, player groups and on-ice data when supplied | Verify penalties, power-play state and goalie statistics separately |
| Soccer | Match events, commentary, formations, lineups and standings when supplied | Verify stoppage time and league-by-league lineup coverage |
| Baseball | Inning score, probable pitchers and pitching decisions | Approved source fields for inning half, count, outs, runners and batting order where absent |
| Tennis | Sets and source-reported tiebreaks | Approved point/server, bracket and point-history fields where absent |
| MMA | Card, bout, round, clock and confirmed winner where supplied | Verify official result method across sampled events |

Use existing event identity and test each supported section in scheduled, live and final states. Unsupported fields remain out of the presentation until validated. Screen-level acceptance, fixture behavior, and active-game official clock comparisons require separate receipts.

## Release 1 physical Android acceptance, November 20, 2026

Tested against the local build with real feed data using Chrome on a Samsung SM-A166U over USB. Each board path returned to the original league and refocused the opener. The football pass showed a 144 px difference from the pre-click scroll position. Exact scroll restoration on physical Android remains open.

| Sport | Matchup or detail sampled | Device result |
|---|---|---|
| Football | Dolphins–Bills; Oregon–Michigan State drive link | NFL score and Back passed. College football displayed nine drives. |
| Basketball | Hornets–Hawks | Players and Back passed. |
| Baseball | Brewers–Rays | Inning score and Back passed. Live count and runners were tested using the MLB fallback fixture. |
| Hockey | Canisius–Niagara | Score and Back passed. The sampled game lacked a detailed timeline. |
| Soccer | Atlético de San Luis–Puebla | Lineups and Back passed. |
| Tennis | Harrison/Skupski–Arévalo/Pavić | Score and Back passed. This fixture was scheduled. A separate final ATP payload included three set scores. |
| MMA | Mitchell–Yousaf | Result tab and Back passed on the scheduled bout. A separate final UFC payload carried result state and clock. |

The saved FanDuel and DraftKings event layouts informed the sport-first detail order with a persistent scoreboard. Mirror logs in `website-captures` record incomplete crawls. Native competitor parity remains open. The Android Fanatics build showed an update gate and the FanDuel, DraftKings, and bet365 launch attempts did not yield verified matchup interactions in this pass.

At 8:11 p.m. Central, the local Hornets–Hawks event returned 96–109 in Q4 at 1:32 across three samples. The matching NBA live-data endpoint returned HTTP 403 on all three requests. This records the local responsive UI path and the independent comparison failure. It does not establish clock accuracy.

To close coverage, supply approved live/recent sample payloads and league coverage for hockey penalties, power plays and goalie stats, baseball count/bases and batting order on the primary feed, tennis point score/server and bracket history, and MMA official result method. Include event identity mapping, source timestamps, and final/correction semantics. For soccer, provide coverage details for stoppage time and confirmed lineups by league.

## Web and PWA feature inventory

| Surface | Existing UI and behavior | Remaining acceptance |
|---|---|---|
| Home and search | SportsGlance, spotlight, grouped Sports board, catalogue search, curated sections and device-local interests | Broader editorial home, cross-browser performance measurements |
| Live and Game Center | Shared score and phase components across compact and expanded cards, seven prioritized detail layouts, share links, polling and fallback labels | Official clock comparison and per-league detail coverage |
| Predictions | Free-pick draft, market controls, review, account sign-in and history; sign-in from a draft resumes review and requires explicit confirmation | Full durable save/lock/settle journey, confidence and performance trends |
| Following and settings | Watchlist, guest follows and import, account-backed follows, My Sports, browser-local language, timezone and interests | Cross-device proof where promised; complete translation coverage |
| Discover | Searchable competition directory with sport and region filters, schedule deep links, existing league news and provider-backed standings | Dedicated team/player hubs and authorized highlights |
| Alerts | In-app alerts and notification settings | App-closed delivery validation |
| Install and offline | PWA manifest, service worker, keyboard-accessible install instructions, read-only snapshot with last-confirmed timestamps, verified Android cold launch and reconnect | Physical iPhone Home Screen install, offline launch, and public HTTPS update behavior |

The current design inventory includes the COWBOY shell, compact MatchCard, expanded schedule rows, shared GameStatus and BoardScore, Game Center, pick tray and dialogs, league and date controls, and account/follow surfaces. Dark is the release default. Full token consolidation, light theme evaluation, and measured performance and accessibility reports remain open.

The later local Samsung Chrome NFL retest restored card focus and returned within one CSS pixel of the pre-open viewport-relative position. Service-worker registration was present in browser mode. Installed standalone launch remains a separate check.

The local production build rendered the football board with zero horizontal overflow at 320, 360, 390, 430, 768, 853, 1200, 1440, and 1920 CSS pixels in Chromium. One real-feed Chromium sample reached the first playable game row in 217 ms on the Mac. This is a single local measurement against a running server and cannot establish a before/after improvement or production latency.

## Installed Android and Safari follow-up

- Chrome on the Samsung installed the local COWBOY PWA and launched it in standalone mode. The installed app opened a real NFL Game Center, switched to Score, and returned to the NFL board. The mobile pick controls now fit inside their own card, with a browser regression check at 320–768 px.
- With the USB route to the local server removed, the installed app opened its read-only saved scoreboard through the persistent Saved scoreboard link. Restoring the route and retrying recovered the same Dolphins–Bills draft. An automatic reload at the same URL sometimes remained on the online shell, so automatic offline launch remains a distinct check.
- Desktop Safari verified Discover search, the Premier League board, a shared Fulham–Manchester City Score link, and keyboard dismissal. Physical iPhone Safari and home-screen installation remain unverified.
- This Android install points to the local server over USB. Public HTTPS install and update behavior require later release verification. A separate Android package is outside this pass.

## Offline cold-launch retest

- The initial Samsung cold launch showed the online shell with a failed score request. The worker now bounds network navigation and serves the saved-score page directly from its precache. A controlled standalone board also opens the saved snapshot when startup has no confirmed board and the transport fails. An HTTP error from the feed remains a board error with its existing retry control.
- With the local origin paused and USB reverse removed, the Samsung launcher opened the saved scoreboard in about 1.3 seconds. It showed 250 saved games with last-confirmed times and zero pick controls. After the origin and USB route were restored, **Try connecting again** recovered the online board. The saved-score screen stays read-only.
- On the iPhone 17 Pro simulator with iOS 26.2, Safari rendered the 219-competition Discover directory and a real scheduled Premier League Game Center. Discover filter controls now have 44 px touch targets. The Game Center header carries the selected schedule time, and the scheduled Score section omits the provider's duplicate time label.
- While the preview origin was paused, a fresh Safari navigation on the same simulator loaded the read-only saved scoreboard, with 250 games and last-confirmed times.
- Playwright WebKit passed the seven fixture-driven sport views, Discover, and install-help checks. A run with genuine data and the origin paused verified snapshot display and reconnect in WebKit. The three offline fixture cases now pass in WebKit and Chromium with the real service worker handling navigation and cache behavior.
- The production build and typecheck passed, as did 230 unit tests and 79 Chromium browser tests. The Discover filters held their 44 px minimum height and the page had no horizontal overflow at 320, 390, 430, 768, 853, 1200, and 1440 CSS pixels.

## Provider handoff for remaining parity

For each feed, supply the approved endpoint and access method, documented league and territory coverage, refresh interval and rate limits, display and retention permissions, attribution, and raw scheduled, in-progress, final, and corrected samples. The same sample game should have a stable provider event ID and participant IDs across scoreboard, detail, play-by-play and final-result endpoints.

| Surface | Specific fields still needed |
|---|---|
| Official clock comparison | Capture authoritative score, period, clock and event status with upstream timestamp and receipt timestamp for an active game in each priority league. Include paused clocks, intermissions, overtime and corrections. |
| Football and basketball | Confirm live possession, down, distance, drive and play IDs by football league. Confirm basketball period clock, scoring plays and player box score availability outside the already sampled leagues. |
| Hockey | Penalty type, offender, team, start and expiry, power-play strength, shots on goal and goalie player IDs, saves and shots faced. |
| Soccer | Source minute, added-time field, typed goals, cards and substitutions, confirmed starting XI, positions and formations by competition. |
| Baseball | Inning and half, balls, strikes, outs, base occupants, batter and pitcher IDs, batting-order positions and substitutions. |
| Tennis | Tournament/draw and round identities, current set/game/point score, server, tiebreak state, point sequence and retirement/walkover rules. |
| MMA | Card and bout identity, round and elapsed clock, outcome method, official winner or no-contest state and amendments. |
| Other sports | League-specific period or set structure, participant identity, state and official final results for rugby, AFL, volleyball, lacrosse, water polo, field hockey and golf. |
| Discovery and picks | Team and player roster/history endpoints, approved highlights, and market/selection identities with opening and closing lines, availability, suspension, correction and settlement policy where free predictions use those markets. |

The local pick check used the real account and picks routes with an isolated file store, a scheduled snapshot, and a captured NBA final fixture. It exercised registration, the 5,000-token grant, sign-out, guest draft, sign-in, explicit confirmation, persisted history after a server restart, rejection after close, final grading, one win award after repeated refresh, and guest isolation. Production Supabase, delivery of account emails, and grading against a live game rollover remain separate checks.

## Team discovery and rendering measurements

- Team selections found on the board now offer schedules and recent finals from the existing team schedule endpoint. The panel loads on expansion, falls back to matching board games, and opens the same Game Center. The route returned eight final and eight upcoming games for both tested NBA teams. The Hornets panel showed four upcoming games and four finals and fit at ten CSS widths from 320 to 2560 px. Searching the full roster of teams outside the current board needs a team directory feed.
- The board avoids rendering the entire screen every second solely to update local labels. It still schedules a game’s pick closure at kickoff. Scheduled cards show their actual lock reason beside the pick controls. Game Center and the pick tray use short entry motion without full-screen backdrop blur, with standard reduced-motion support.
- A 5120 × 2880 headless Chromium render of a sourced Premier League Game Center fit without document overflow. A short tab-switch sample measured 16.7 ms median and 16.8 ms at the 95th percentile between frame callbacks. The installed Samsung PWA sample measured 11.2 ms median and 66.7 ms at the 95th percentile. These runs measure frame callbacks on separate environments. Sustained high refresh on physical 5K and consistently smooth mobile interaction remain open.
