import { LIVE_LEAGUES } from "./sports-leagues";

// Market reference shows what posted sportsbook prices imply about a game's
// outcome. It is display-only context for free picks — never a price a user can
// wager, and always labeled as a reference in the UI.
export type MarketProbabilities = { home: number; away: number; draw: number | null };
export type MarketQuote = MarketProbabilities & { provider: string; fetchedAt: string };
export type MarketReference = MarketQuote & {
  /** First observed implied probabilities for this event; null until a baseline exists. */
  open: MarketProbabilities | null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SUCCESS_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function americanToImplied(odds: unknown): number | null {
  const value = Number(odds);
  if (!Number.isFinite(value) || value === 0 || value < -100000 || value > 100000) return null;
  const probability = value > 0 ? 100 / (value + 100) : -value / (-value + 100);
  return probability > 0 && probability < 1 ? probability : null;
}

function moneyLine(item: Record<string, any>): { home: number | null; away: number | null; draw: number | null } {
  return {
    home: americanToImplied(object(item.homeTeamOdds).moneyLine),
    away: americanToImplied(object(item.awayTeamOdds).moneyLine),
    draw: americanToImplied(object(item.drawOdds).moneyLine),
  };
}

function normalize(lines: { home: number | null; away: number | null; draw: number | null }) {
  const parts = [lines.home, lines.away, lines.draw].filter((value): value is number => value !== null);
  if (parts.length < 2 || lines.home === null || lines.away === null) return null;
  const total = parts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const round = (value: number) => Math.round((value / total) * 10000) / 10000;
  return {
    home: round(lines.home),
    away: round(lines.away),
    draw: lines.draw === null ? null : round(lines.draw),
  };
}

function chooseItem(items: Record<string, any>[]): Record<string, any> | undefined {
  const usable = items.filter(item => {
    const lines = moneyLine(item);
    return lines.home !== null && lines.away !== null;
  });
  if (!usable.length) return undefined;
  // Prefer the standard (non-live) DraftKings board, then any named book, then first.
  return usable.find(item => text(object(item.provider).id) === "100")
    ?? usable.find(item => /draftkings/i.test(text(object(item.provider).name)) && !/live/i.test(text(object(item.provider).name)))
    ?? usable[0];
}

function parseMarket(payload: unknown, now: () => number): MarketQuote | null {
  const root = object(payload);
  const items = (Array.isArray(payload) ? payload : Array.isArray(root.items) ? root.items : [])
    .map(object);
  const item = chooseItem(items);
  if (!item) return null;
  const lines = normalize(moneyLine(item));
  if (!lines) return null;
  const provider = text(object(item.provider).name) || "Provider unavailable";
  return { ...lines, provider: provider.slice(0, 60), fetchedAt: new Date(now()).toISOString() };
}

export function createMarketReferenceClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const cache = new Map<string, { value: MarketQuote | null; open: MarketProbabilities | null; expires: number }>();
  const pending = new Map<string, Promise<MarketReference | null>>();

  async function fetchMarket(league: string, id: string): Promise<MarketQuote | null> {
    const config = LIVE_LEAGUES.find(entry => entry.id === league && entry.sport !== "golf");
    if (!config) return null;
    const [sport, leaguePath] = config.path.split("/");
    if (!sport || !leaguePath) return null;
    const competitionId = id.split("-")[0];
    const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${leaguePath}/events/${id}/competitions/${competitionId}/odds?limit=50`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) { await response.body?.cancel().catch(() => undefined); return null; }
      const payload: unknown = await response.json();
      return parseMarket(payload, now);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async get(league: string, id: string): Promise<MarketReference | null> {
      if (!/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id)) return null;
      const key = `${league}:${id}`;
      const cached = cache.get(key);
      if (cached && cached.expires > now()) {
        return cached.value ? { ...cached.value, open: cached.open } : null;
      }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const request = fetchMarket(league, id)
        .then(value => {
          const previous = cache.get(key);
          const open = previous?.open ?? (value ? { home: value.home, away: value.away, draw: value.draw } : null);
          cache.set(key, { value, open, expires: now() + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
          if (cache.size > 500) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          return value ? { ...value, open } : null;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

const shared = createMarketReferenceClient();
export const getMarketReference = (league: string, id: string) => shared.get(league, id);
