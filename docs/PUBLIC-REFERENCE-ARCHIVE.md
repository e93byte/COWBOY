# Public reference archive

The COWBOY app and the public reference archive serve different purposes. The app implements free picks, live scores, Game Center, and watchlists. The archive records how public sportsbook pages display navigation, match information, and support. Public sports publishers supply additional evidence where the corresponding sportsbook page is unavailable.

[Original 745-route inventory](public-reference-routes.json) records the status of each original URL. A rendered original page, an offline replay, and a related publisher reference are recorded independently. Offline verification checks page-specific content and local styles in Chromium with networking disabled. Such a replay preserves the observed view. Interactive operator features and private services require their own implementation and verification.

The full archive includes rendered HTML, screenshots, stylesheets, and other media. Those files live in the shared SAHAND archive. This Git repository carries COWBOY source code, its tests, and the route inventory without duplicating the multi-gigabyte archive.

## November 17 checkpoint

The original queue has **694 exact renders and 51 gaps**. All 694 exact captures have a browser transcript, screenshot, and saved styles. Among them, 598 have saved HTML, 596 have a styled offline replay, and the remaining 98 have a screenshot and transcript reader. The broader archive contains **6,351 styled views**, including references outside the original queue.

The original Friends Mode league page and league-creation page now render at their exact URLs, replacing two shell-only captures. Their offline views preserve the public navigation, league options, sport selector, Name and Description controls, and first-party styling. The archived controls are inert. Both views passed content and stylesheet checks with 24 loaded stylesheets and zero network requests. The archive records exact renders separately from corrected URLs and publisher references.

Every remaining original URL now has a terminal disposition in the route inventory. The 51 gaps comprise 25 removed pages, 16 operator redirects, four historical partial captures whose current URLs return Page not found, two shell-only routes, two excluded interactive casino launch routes, one redirect loop, and one published template error. These states are evidence about the current public web. Repeating the same crawl cannot turn removed or redirecting URLs into exact pages.

## How this informs the app

| Reference | What to compare in COWBOY |
| --- | --- |
| Sportsbook navigation and league boards | Active sports and league tabs, status labels, and the visual order of scores, clocks, and game links. |
| Official A-League fixtures and Nations League results | Competition, matchweek, venue, kickoff timezone, and final score. |
| Official ITF qualifying draws | The identity of each singles matchup and the published set and tiebreak scores. |
| Federation-linked box scores and play-by-play | Period totals, player statistics, and the timestamped sequence of game events. |
| Public help categories | Clear topic navigation and discoverable account and consumer-protection settings. |

See [score endpoints and interface references](SCORE-ENDPOINTS-AND-ICONS.md) for the feeds and controls already used in COWBOY. Archive evidence supports a comparison of visible behavior. Full product parity remains a separate implementation and acceptance task.
