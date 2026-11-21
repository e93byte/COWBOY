import { LIVE_LEAGUES } from "./sports-leagues";
import type { GameOdds } from "./live-sports";

// Exchange odds converts Kalshi prediction-market prices into American odds so
// the Game Center can show real multi-book pricing alongside sportsbook
// references. Spread/total ladders are reduced to their main line — the strike
// nearest a 50% cover probability. Prices are display-only reference context,
// never a wager.

export type ExchangeGame = {
  home: number | null;
  away: number | null;
  draw: number | null;
  spread: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  fetchedAt: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_EVENTS_PER_SERIES = 200;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const API = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi series tickers per market type, keyed by COWBOY league.
const SERIES: Record<string, { game?: string; spread?: string; total?: string }> = {
  nfl: { game: "KXNFLGAME", spread: "KXNFLSPREAD", total: "KXNFLTOTAL" },
  nba: { game: "KXNBAGAME", spread: "KXNBASPREAD", total: "KXNBATOTAL" },
  wnba: { game: "KXWNBAGAME", spread: "KXWNBASPREAD", total: "KXWNBATOTAL" },
  mlb: { game: "KXMLBGAME", spread: "KXMLBSPREAD", total: "KXMLBTOTAL" },
  nhl: { game: "KXNHLGAME", spread: "KXNHLSPREAD", total: "KXNHLTOTAL" },
  ncaaf: { game: "KXNCAAFGAME", spread: "KXNCAAFSPREAD" },
  ncaab: { game: "KXNCAAMBGAME", spread: "KXNCAAMBSPREAD", total: "KXNCAAMBTOTAL" },
  epl: { game: "KXEPLGAME", spread: "KXEPLSPREAD", total: "KXEPLTOTAL" },
  mls: { game: "KXMLSGAME", total: "KXMLSTOTAL" },
  ufc: { game: "KXUFCFIGHT" },
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  yes_sub_title?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  last_price_dollars?: string;
  status?: string;
  floor_strike?: number | string | null;
  expected_expiration_time?: string;
};
type KalshiEvent = {
  event_ticker?: string;
  title?: string;
  sub_title?: string;
  markets?: KalshiMarket[];
};
type KalshiFeed = { cursor?: string; events?: KalshiEvent[] };

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function dollarsToProbability(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

/** Midpoint of the YES bid/ask, falling back to last trade. */
function marketProbability(market: KalshiMarket): number | null {
  if (market.status && market.status !== "active" && market.status !== "open") return null;
  const bid = dollarsToProbability(market.yes_bid_dollars);
  const ask = dollarsToProbability(market.yes_ask_dollars);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return dollarsToProbability(market.last_price_dollars) ?? ask ?? bid;
}

function probabilityToAmerican(probability: number): number {
  const p = Math.min(0.99, Math.max(0.01, probability));
  const odds = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
  return Math.round(odds);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

/** True when every token of `needle` appears in `haystack` (city ⊂ full team name). */
function covers(needle: string, haystack: string): boolean {
  const n = tokens(needle);
  if (!n.size) return false;
  const h = tokens(haystack);
  for (const token of n) if (!h.has(token)) return false;
  return true;
}

// ---------- feed parsing ----------

type RawOutcome = { name: string; probability: number };
type RawGame = {
  ticker: string;
  /** Suffix shared across a matchup's game/spread/total events. */
  key: string;
  title: string;
  startsAt: string | null;
  outcomes: RawOutcome[];
};
type RawLadderEvent = {
  key: string;
  /** team name -> floor_strike -> cover probability */
  teamStrikes: Map<string, Map<number, number>>;
  /** floor_strike -> over probability (totals) */
  totalStrikes: Map<number, number>;
};

function eventKey(ticker: string | undefined): string {
  if (!ticker) return "";
  const dash = ticker.indexOf("-");
  return dash === -1 ? ticker : ticker.slice(dash + 1);
}

function parseGameFeed(payload: KalshiFeed | null): RawGame[] {
  const games: RawGame[] = [];
  for (const event of payload?.events ?? []) {
    const ticker = text(event.event_ticker);
    const key = eventKey(ticker);
    const markets = (event.markets ?? []).filter(market => marketProbability(market) !== null);
    if (!key || markets.length < 2 || markets.length > 4) continue;
    const outcomes: RawOutcome[] = [];
    const seen = new Set<string>();
    for (const market of markets) {
      const name = text(market.yes_sub_title) || text(market.title);
      const probability = marketProbability(market);
      const dedupe = normalizeName(name);
      if (!name || probability === null || !dedupe || seen.has(dedupe)) continue;
      seen.add(dedupe);
      outcomes.push({ name, probability });
    }
    if (outcomes.length < 2) continue;
    games.push({
      ticker, key,
      title: text(event.title) || text(event.sub_title),
      startsAt: text(event.markets?.[0]?.expected_expiration_time) || null,
      outcomes,
    });
  }
  return games;
}

const TEAM_MARGIN_RE = /^(.*?)\s+wins by over\s+(-?[\d.]+)\s+points?$/i;
const TOTAL_OVER_RE = /over\s+(-?[\d.]+)\s+points?/i;

function parseLadderFeed(payload: KalshiFeed | null, kind: "spread" | "total"): RawLadderEvent[] {
  const events = new Map<string, RawLadderEvent>();
  for (const event of payload?.events ?? []) {
    const key = eventKey(event.event_ticker);
    if (!key) continue;
    const entry = events.get(key) ?? { key, teamStrikes: new Map(), totalStrikes: new Map() };
    for (const market of event.markets ?? []) {
      const probability = marketProbability(market);
      if (probability === null) continue;
      const strike = Number(market.floor_strike);
      if (!Number.isFinite(strike)) continue;
      const name = text(market.yes_sub_title) || text(market.title);
      if (kind === "total") {
        if (!TOTAL_OVER_RE.test(name)) continue;
        entry.totalStrikes.set(strike, probability);
      } else {
        const match = TEAM_MARGIN_RE.exec(name);
        if (!match) continue;
        const team = match[1].trim();
        const marginStrike = Number(match[2]);
        if (!team || !Number.isFinite(marginStrike)) continue;
        // Key strikes by the margin line, not the raw floor (they coincide).
        const teamMap = entry.teamStrikes.get(team) ?? new Map<number, number>();
        teamMap.set(marginStrike, probability);
        entry.teamStrikes.set(team, teamMap);
      }
    }
    events.set(key, entry);
  }
  return [...events.values()].filter(entry =>
    kind === "total" ? entry.totalStrikes.size >= 2 : [...entry.teamStrikes.values()].some(map => map.size >= 2));
}

/** The strike whose cover probability sits nearest 50% — the main line. */
function mainStrike(strikes: Map<number, number>): { line: number; probability: number } | null {
  let best: { line: number; probability: number } | null = null;
  let bestDistance = Infinity;
  for (const [line, probability] of strikes) {
    const distance = Math.abs(probability - 0.5);
    if (distance < bestDistance) { bestDistance = distance; best = { line, probability }; }
  }
  return best;
}

// ---------- matching ----------

function matchMoneyline(games: RawGame[], homeName: string, awayName: string, startsAt: string): RawGame | null {
  const target = Date.parse(startsAt);
  if (!Number.isFinite(target)) return null;
  for (const game of games) {
    const gameTime = game.startsAt ? Date.parse(game.startsAt) : NaN;
    // Kalshi expirations can drift a day; accept a 72h window around kickoff.
    if (Number.isFinite(gameTime) && Math.abs(gameTime - target) > 72 * 3_600_000) continue;
    let homeProb: number | null = null;
    let awayProb: number | null = null;
    let drawProb: number | null = null;
    let ambiguous = false;
    for (const outcome of game.outcomes) {
      const name = outcome.name;
      if (/^draw$|^tie$/i.test(normalizeName(name)) || /^draw/i.test(name)) {
        drawProb = outcome.probability;
        continue;
      }
      const homeMatch = covers(name, homeName);
      const awayMatch = covers(name, awayName);
      if (homeMatch === awayMatch) { ambiguous = true; break; } // both or neither
      if (homeMatch) {
        if (homeProb !== null) { ambiguous = true; break; }
        homeProb = outcome.probability;
      } else {
        if (awayProb !== null) { ambiguous = true; break; }
        awayProb = outcome.probability;
      }
    }
    if (ambiguous || homeProb === null || awayProb === null) continue;
    return game;
  }
  return null;
}

// ---------- client ----------

type LeagueFeed = { games: RawGame[]; spreads: RawLadderEvent[]; totals: RawLadderEvent[] };

export function createExchangeOddsClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const leagueCache = new Map<string, { feed: LeagueFeed; expires: number }>();
  const leaguePending = new Map<string, Promise<LeagueFeed>>();

  async function fetchJson(url: string): Promise<KalshiFeed | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) return null;
      if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      return await response.json() as KalshiFeed;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchSeries(series: string): Promise<KalshiFeed | null> {
    const url = new URL(`${API}/events`);
    url.searchParams.set("series_ticker", series);
    url.searchParams.set("limit", String(MAX_EVENTS_PER_SERIES));
    url.searchParams.set("status", "open");
    url.searchParams.set("with_nested_markets", "true");
    return fetchJson(url.toString());
  }

  async function loadFeed(league: string): Promise<LeagueFeed> {
    const series = SERIES[league];
    if (!series?.game || !LIVE_LEAGUES.some(config => config.id === league)) {
      return { games: [], spreads: [], totals: [] };
    }
    const cached = leagueCache.get(league);
    if (cached && cached.expires > now()) return cached.feed;
    const inFlight = leaguePending.get(league);
    if (inFlight) return inFlight;
    const request = (async () => {
      const [gameFeed, spreadFeed, totalFeed] = await Promise.all([
        fetchSeries(series.game!),
        series.spread ? fetchSeries(series.spread) : Promise.resolve(null),
        series.total ? fetchSeries(series.total) : Promise.resolve(null),
      ]);
      const feed: LeagueFeed = {
        games: parseGameFeed(gameFeed),
        spreads: parseLadderFeed(spreadFeed, "spread"),
        totals: parseLadderFeed(totalFeed, "total"),
      };
      const hasData = feed.games.length + feed.spreads.length + feed.totals.length > 0;
      leagueCache.set(league, { feed, expires: now() + (hasData ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
      return feed;
    })().finally(() => leaguePending.delete(league));
    leaguePending.set(league, request);
    return request;
  }

  /** Resolve a ladder event's team strikes to home/away using name coverage. */
  function ladderForEvent(entry: RawLadderEvent | undefined, homeName: string, awayName: string) {
    if (!entry) return null;
    let homeStrikes: Map<number, number> | null = null;
    let awayStrikes: Map<number, number> | null = null;
    for (const [team, strikes] of entry.teamStrikes) {
      const homeMatch = covers(team, homeName);
      const awayMatch = covers(team, awayName);
      if (homeMatch === awayMatch) return null; // ambiguous
      if (homeMatch) homeStrikes = strikes;
      else awayStrikes = strikes;
    }
    return { homeStrikes, awayStrikes };
  }

  return {
    /** American-odds quote for one ESPN event, or null when unmatched. */
    async forEvent(league: string, homeName: string, awayName: string, startsAt: string): Promise<ExchangeGame | null> {
      const feed = await loadFeed(league);
      if (!feed.games.length) return null;
      const game = matchMoneyline(feed.games, homeName, awayName, startsAt);
      if (!game) return null;

      // Moneyline probabilities per side (draw stays null for now — most
      // Kalshi game markets are two-sided).
      let homeProb: number | null = null;
      let awayProb: number | null = null;
      let drawProb: number | null = null;
      for (const outcome of game.outcomes) {
        if (/^draw$|^tie$/i.test(normalizeName(outcome.name)) || /^draw/i.test(outcome.name)) {
          drawProb = outcome.probability;
          continue;
        }
        if (covers(outcome.name, homeName)) homeProb = outcome.probability;
        else awayProb = outcome.probability;
      }
      if (homeProb === null || awayProb === null) return null;

      // Spread: pick each side's strike nearest 50%, then orient by favorite.
      let spread: number | null = null;
      let homeSpreadPrice: number | null = null;
      let awaySpreadPrice: number | null = null;
      const spreadEntry = feed.spreads.find(item => item.key === game.key);
      const spreadSides = ladderForEvent(spreadEntry, homeName, awayName);
      if (spreadSides?.homeStrikes?.size && spreadSides.awayStrikes?.size) {
        const homeMain = mainStrike(spreadSides.homeStrikes);
        const awayMain = mainStrike(spreadSides.awayStrikes);
        if (homeMain && awayMain) {
          // The favorite's median margin sets the main line magnitude.
          const homeFavored = homeProb > awayProb;
          const favoriteMain = homeFavored ? homeMain : awayMain;
          const magnitude = Math.abs(favoriteMain.line);
          if (magnitude > 0 && magnitude <= 60) {
            spread = homeFavored ? -magnitude : magnitude;
            // Price each side at its own main strike; the dog side uses the
            // complement of the favorite's cover probability at that line.
            homeSpreadPrice = probabilityToAmerican(
              homeFavored ? homeMain.probability : 1 - favoriteMain.probability);
            awaySpreadPrice = probabilityToAmerican(
              homeFavored ? 1 - favoriteMain.probability : awayMain.probability);
          }
        }
      }

      // Total: the over strike nearest 50% is the main total.
      let total: number | null = null;
      let overPrice: number | null = null;
      let underPrice: number | null = null;
      const totalEntry = feed.totals.find(item => item.key === game.key);
      if (totalEntry) {
        const overMain = mainStrike(totalEntry.totalStrikes);
        if (overMain && overMain.line > 0 && overMain.line <= 400) {
          total = overMain.line;
          overPrice = probabilityToAmerican(overMain.probability);
          underPrice = probabilityToAmerican(1 - overMain.probability);
        }
      }

      return {
        home: probabilityToAmerican(homeProb),
        away: probabilityToAmerican(awayProb),
        draw: drawProb !== null ? probabilityToAmerican(drawProb) : null,
        spread, homeSpreadPrice, awaySpreadPrice,
        total, overPrice, underPrice,
        fetchedAt: new Date(now()).toISOString(),
      };
    },
    /** All parsed games for a league (debug/board surfaces). */
    async games(league: string): Promise<RawGame[]> {
      return (await loadFeed(league)).games;
    },
  };
}

const shared = createExchangeOddsClient();
export const getExchangeOdds = (league: string, homeName: string, awayName: string, startsAt: string) =>
  shared.forEvent(league, homeName, awayName, startsAt);
