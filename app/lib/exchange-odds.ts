import { LIVE_LEAGUES } from "./sports-leagues";
import type { GameOdds } from "./live-sports";

// Exchange odds converts Kalshi game-winner prices into American odds so the
// Game Center can show real multi-book pricing alongside sportsbook references.
// Prices are exchange probabilities — display-only context, never a wager.

export type ExchangeGame = {
  home: number | null;
  away: number | null;
  draw: number | null;
  fetchedAt: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_EVENTS_PER_LEAGUE = 200;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const API = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi series tickers for outright game-winner markets, keyed by COWBOY league.
const SERIES: Record<string, string> = {
  nfl: "KXNFLGAME",
  nba: "KXNBAGAME",
  wnba: "KXWNBAGAME",
  mlb: "KXMLBGAME",
  nhl: "KXNHLGAME",
  ncaaf: "KXNCAAFGAME",
  ncaab: "KXNCAAMBGAME",
  epl: "KXEPLGAME",
  mls: "KXMLSGAME",
  ufc: "KXUFCFIGHT",
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  yes_sub_title?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  last_price_dollars?: string;
  expected_expiration_time?: string;
  status?: string;
  floor_strike?: number | string | null;
  custom_strike?: Record<string, unknown> | null;
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

type RawOutcome = { name: string; probability: number };
type RawGame = { title: string; startsAt: string | null; outcomes: RawOutcome[] };

function parseFeed(payload: KalshiFeed | null): RawGame[] {
  const games: RawGame[] = [];
  for (const event of payload?.events ?? []) {
    const markets = (event.markets ?? []).filter(market => marketProbability(market) !== null);
    if (markets.length < 2 || markets.length > 4) continue;
    const outcomes: RawOutcome[] = [];
    const seen = new Set<string>();
    for (const market of markets) {
      const name = text(market.yes_sub_title) || text(market.title);
      const probability = marketProbability(market);
      const key = normalizeName(name);
      if (!name || probability === null || !key || seen.has(key)) continue;
      seen.add(key);
      outcomes.push({ name, probability });
    }
    if (outcomes.length < 2) continue;
    const startsAt = text(event.markets?.[0]?.expected_expiration_time) || null;
    games.push({
      title: text(event.title) || text(event.sub_title),
      startsAt,
      outcomes,
    });
  }
  return games;
}

/**
 * Match a Kalshi game to an ESPN event. Kalshi lists city-level names
 * ("Kansas City") while ESPN uses full names ("Kansas City Chiefs"), so a
 * match requires both outcomes to resolve to distinct sides unambiguously.
 */
function matchGame(games: RawGame[], homeName: string, awayName: string, startsAt: string): ExchangeGame | null {
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
    return {
      home: probabilityToAmerican(homeProb),
      away: probabilityToAmerican(awayProb),
      draw: drawProb !== null ? probabilityToAmerican(drawProb) : null,
      fetchedAt: new Date(0).toISOString(),
    };
  }
  return null;
}

export function createExchangeOddsClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const leagueCache = new Map<string, { games: RawGame[]; expires: number }>();
  const leaguePending = new Map<string, Promise<RawGame[]>>();

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

  async function loadGames(league: string): Promise<RawGame[]> {
    const series = SERIES[league];
    if (!series || !LIVE_LEAGUES.some(config => config.id === league)) return [];
    const cached = leagueCache.get(league);
    if (cached && cached.expires > now()) return cached.games;
    const inFlight = leaguePending.get(league);
    if (inFlight) return inFlight;
    const request = (async () => {
      const url = new URL(`${API}/events`);
      url.searchParams.set("series_ticker", series);
      url.searchParams.set("limit", String(MAX_EVENTS_PER_LEAGUE));
      url.searchParams.set("status", "open");
      url.searchParams.set("with_nested_markets", "true");
      const payload = await fetchJson(url.toString());
      const games = parseFeed(payload);
      leagueCache.set(league, { games, expires: now() + (games.length ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
      return games;
    })().finally(() => leaguePending.delete(league));
    leaguePending.set(league, request);
    return request;
  }

  return {
    /** American-odds quote for one ESPN event, or null when unmatched. */
    async forEvent(league: string, homeName: string, awayName: string, startsAt: string): Promise<ExchangeGame | null> {
      const games = await loadGames(league);
      if (!games.length) return null;
      const match = matchGame(games, homeName, awayName, startsAt);
      return match ? { ...match, fetchedAt: new Date(now()).toISOString() } : null;
    },
    /** All parsed games for a league (debug/board surfaces). */
    async games(league: string): Promise<RawGame[]> {
      return loadGames(league);
    },
  };
}

const shared = createExchangeOddsClient();
export const getExchangeOdds = (league: string, homeName: string, awayName: string, startsAt: string) =>
  shared.forEvent(league, homeName, awayName, startsAt);
