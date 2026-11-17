# Public reference archive

The COWBOY app and the public reference archive serve different purposes. The app implements free picks, live scores, Game Center, and watchlists. The archive records how public sportsbook pages display navigation, match information, and support. Public sports publishers supply additional evidence where the corresponding sportsbook page is unavailable.

[Original 745-route inventory](public-reference-routes.json) records the status of each original URL. A rendered original page, an offline replay, and a related publisher reference are recorded independently. Offline verification checks page-specific content and local styles in Chromium with networking disabled. Such a replay preserves the observed view. Interactive operator features and private services require their own implementation and verification.

The full archive includes rendered HTML, screenshots, stylesheets, and other media. Those files live in the shared SAHAND archive. This Git repository carries COWBOY source code, its tests, and the route inventory without duplicating the multi-gigabyte archive.

## November 17 checkpoint

The original queue has **692 exact renders and 53 gaps**. All 692 exact captures have a browser transcript, screenshot, and saved styles. Among them, 596 have saved HTML, 595 have a styled offline replay, and the remaining 97 have a screenshot and transcript reader. The broader archive contains **6,349 styled views**, including references outside the original queue.

The original Predicts help category now renders with topic navigation and a saved first-party stylesheet. Two corrected help URLs provide the articles behind four malformed originals. The Santa Cruz qualifying draw and UEFA Nations League C results cover the corresponding competition gaps. All five newly saved views passed the offline content and stylesheet checks and made zero network requests. The archive records exact renders separately from corrected URLs and publisher references.

## How this informs the app

| Reference | What to compare in COWBOY |
| --- | --- |
| Sportsbook navigation and league boards | Active sports and league tabs, status labels, and the visual order of scores, clocks, and game links. |
| Official A-League fixtures and Nations League results | Competition, matchweek, venue, kickoff timezone, and final score. |
| Official ITF qualifying draws | The identity of each singles matchup and the published set and tiebreak scores. |
| Federation-linked box scores and play-by-play | Period totals, player statistics, and the timestamped sequence of game events. |
| Public help categories | Clear topic navigation and discoverable account and consumer-protection settings. |

See [score endpoints and interface references](SCORE-ENDPOINTS-AND-ICONS.md) for the feeds and controls already used in COWBOY. Archive evidence supports a comparison of visible behavior. Full product parity remains a separate implementation and acceptance task.
