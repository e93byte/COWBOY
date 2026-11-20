# COWBOY — Handoff & Next-Level Roadmap

Status as of commit `f227e4f` (local `main`, **3 commits ahead of `origin/main`, not yet deployed**).

Verification baseline: **165/165 unit tests, typecheck clean, `next build` green, 67/67 Playwright specs.**

---

## 1. Deploy first — production is 3 commits behind

`betcowboy.vercel.app` 404s on `/api/sports/futures`, `/api/sports/props`, `/api/sports/news`, `/api/sports/market`, `/api/picks/consensus`. Vercel deploys from GitHub; nothing was ever pushed.

- [ ] `git push origin main` (requires authorization)
- [ ] Verify on production: all five routes return 200; board shows fresh `fetchedAt`; "Delayed data" banner only when a league is actually degraded
- [ ] Rollback plan if needed: Vercel → Deployments → Instant Rollback, or `git revert` + push
- [ ] Pre-deploy check: confirm `.cowboy-data/`, `.env*` are untracked; confirm no secrets in repo

## 2. "All 50 states" — positioning, not plumbing

COWBOY is free-to-play with no wagering, so **no geo-gating exists or is needed** — picks, board, accounts, and notifications already work identically in every state. What is missing is *saying so correctly*:

- [ ] Add an availability statement to `/help` and footer: "Free predictions. No purchase, no wagering — available in all 50 states." (Never say "sportsbook," "bet," or "odds" in consumer copy — the e2e suite enforces this.)
- [ ] Keep the existing legal framing everywhere: "no money, purchase, cash prizes or wagering."
- [ ] Do **not** add real-money flows, deposits, or "cash out" — that is what would trigger state-by-state gambling licensing. The 50-state claim is only true *because* we stay free.
- [ ] Optional: a `/states` or FAQ entry explaining why free pick 'em isn't geo-restricted (no consideration → not gambling in all states; still confirm with counsel before public marketing claims).

## 3. API strategy — from "working ladder" to "superior system"

Current stack (`app/lib/live-sports.ts`): ESPN primary → NHL/MLB official overlays → LiveScore → OpenLigaDB → SportsDB (key-gated) → ESPN summary fallback. Plus Kalshi (futures), ESPN core (odds/props/news). All free, all with per-league circuit breakers, host cooldowns, pacing, stale-while-revalidate.

### Tier 0 — keep free (already shipped, do not regress)
ESPN scoreboards/summary/odds/props/news · NHL api-web · MLB statsapi · LiveScore · OpenLigaDB bl1–3 · Kalshi · SportsDB (free test key works).

### Tier 1 — free-but-verified upgrades (next sprint)
- [ ] **SportsDB key**: set `SPORTSDB_KEY` in Vercel env to arm the last fallback rung (code already skips it when unset).
- [ ] **Per-league provider matrix doc**: for each of the 50 leagues, record primary + ordered fallbacks + which overlays apply (NHL/MLB). Single source of truth for "what happens when X dies."
- [ ] **Provider health history**: persist per-league `lastSuccessAt`/error rates (even just in-memory ring buffer exposed on `/api/sports`) so degradation is visible before users report it.

### Tier 2 — keyed upgrades (decision required, quota review first)
| Provider | Unlocks | Free tier | Cost risk |
|---|---|---|---|
| The Odds API | multi-book odds, line history | 500 req/mo | low — budget ~10 req/day |
| API-Football | soccer lineups, injuries, live detail | 100 req/day | low — one league/day rotation |
| SportsDataIO | NFL/NBA props, deeper stats | paid only | medium — start with one sport |
| Sportradar/Sportmonks | enterprise depth | trial | high — defer until revenue |

Rules for any keyed provider: env-var only, never committed; per-key daily budget enforced in code; informational-only labeling ("reference only, not a wager"); graceful no-key degradation must be the tested default path.

### Tier 3 — resilience hardening (this quarter)
- [ ] Quota/budget ledger per provider key (in-memory + daily reset; refuse calls past budget rather than fail mid-board).
- [ ] Cross-provider *score* arbitration: when backup source and primary disagree on a live score, prefer primary but flag the conflict — never silently override.
- [ ] Alerting hook: when >N leagues are non-ok for >M minutes, emit a signal (even a logged metric is enough to start).
- [ ] Cold-start warmup: on server boot, pre-warm the board cache so the first user doesn't eat the 12s refresh deadline.

## 4. Remaining feature backlog (priority order)

1. **Deploy + Supabase activation** — **DONE locally**: schema migrated to `hdkdsbxgfknxexoeyxci` via `supabase/migrations/20260714000000_cowboy_account_store.sql`, API keys in `.env.local` (gitignored), live smoke test passed (register/session/pick/list/logout). *Remaining: add `COWBOY_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to Vercel env and redeploy; without them production keeps using the file store.*
2. **Merge the other agent's in-flight work** — uncommitted: `EventDetail.tsx`, `sports-leagues.ts`, `live.css`, `app/lib/odds.ts` (odds normalization), `SportIcon` odds glyph, futures/props refinements. Review, test, commit — do not lose it.
3. **Background push notifications** — VAPID + service worker `push` handler; current alerts only fire with an open tab.
4. **Props depth** — ESPN `propBets` is wired but thin; real prop boards need Tier-2 keys.
5. **Contests/leaderboards** — blocked on identity: needs usernames or anonymous-but-durable player IDs. Product decision first.
6. **Personal stats dashboard** — win rate, streaks, per-sport record on `/picks` (no public identity needed).
7. **Deferred data work** — football-data form badges (needs reliable cross-provider team matching), LiveScore live cross-check (fallback already covers it; override risk), ScoreBat highlight links.

## 5. Ops checklist before calling it production

- [ ] Monitoring: uptime check on `/api/sports` (expect <3s, 200), alert on `stale:true` persisting >15 min
- [ ] Rate-limit audit: confirm Vercel function concurrency vs provider pacing (60ms/host) — serverless instances each pace independently, so effective rate = instances × pace; acceptable for free APIs, verify after deploy
- [ ] `.cowboy-data` must not be used in production (ephemeral filesystem) — covered by item 4.1
- [ ] Legal copy review of all "free picks" surfaces before paid marketing
- [ ] `sites/cowboy` router: stays idle (decision made); archive or keep as reference — do not wire a second hop into the live path

## 6. What NOT to do

- No real-money sportsbook surfaces (deposits, cash-out, wallets, odds execution) — kills the 50-state claim and the brand
- No competitor assets/branding from `sites/` scrapes — research only
- No new providers just to increase count — every addition must fill a real league/market gap
- No keyed-provider integration without quota/budget guards and a tested keyless fallback path
