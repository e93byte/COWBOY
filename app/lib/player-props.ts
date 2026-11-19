import { LIVE_LEAGUES } from "./sports-leagues";

// Player props are sportsbook lines displayed as reference context for free
// picks. They are informational only — never a price a user can wager.
export type PlayerProp = {
  /** Athlete display name resolved from the event boxscore. */
  player: string;
  /** Prop label, e.g. "Points". */
  name: string;
  line: number;
  /** American odds for the over side. */
  over: number;
  /** American odds for the under side. */
  under: number;
};
export type PlayerProps = { book: string; props: PlayerProp[]; fetchedAt: string };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SUCCESS_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_PROPS = 12;
const PROP_SPORTS = new Set(["football", "basketball", "baseball", "hockey", "soccer"]);
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function americanOdds(value: unknown): number | null {
  const odds = Number(value);
  return Number.isFinite(odds) && odds !== 0 && Math.abs(odds) <= 100000 ? odds : null;
}

function athleteId(ref: unknown): string {
  return text(ref).split("/athletes/")[1]?.split("?")[0] ?? "";
}

function propLabel(type: string): string {
  return type.replace(/^Total\s+/i, "").slice(0, 40) || "Prop";
}

/** Player display names from the event summary boxscore (scoreboard + bench). */
function playerNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const players = object(payload).boxscore?.players;
  if (!Array.isArray(players)) return names;
  for (const group of players) {
    const statistics = object(group).statistics;
    if (!Array.isArray(statistics)) continue;
    for (const stat of statistics) {
      const athletes = object(stat).athletes;
      if (!Array.isArray(athletes)) continue;
      for (const entry of athletes) {
        const athlete = object(object(entry).athlete);
        const id = text(athlete.id);
        const name = text(athlete.displayName) || text(athlete.shortName);
        if (id && name) names.set(id, name.slice(0, 80));
      }
    }
  }
  return names;
}

function parseProps(payload: unknown, names: Map<string, string>): PlayerProp[] {
  const items = Array.isArray(object(payload).items) ? object(payload).items.map(object) : [];
  const groups = new Map<string, Record<string, any>[]>();
  for (const item of items) {
    const id = athleteId(item.athlete?.$ref);
    const type = text(object(item.type).name);
    const line = Number(object(item.current).target?.value ?? object(item.odds).total?.value);
    if (!id || !type || !Number.isFinite(line)) continue;
    const key = `${id}|${type}|${line}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const props: PlayerProp[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2 || props.length >= MAX_PROPS) continue;
    const [id, type] = key.split("|");
    // ESPN returns one row per side; consecutive rows are the over/under pair.
    const over = americanOdds(object(group[0].odds).american?.value);
    const under = americanOdds(object(group[1].odds).american?.value);
    const line = Number(object(group[0].current).target?.value ?? object(group[0].odds).total?.value);
    if (over === null || under === null || !Number.isFinite(line)) continue;
    props.push({
      player: names.get(id) ?? `Athlete ${id}`,
      name: propLabel(type),
      line,
      over: Math.round(over),
      under: Math.round(under),
    });
  }
  return props;
}

export function createPlayerPropsClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const cache = new Map<string, { value: PlayerProps | null; expires: number }>();
  const pending = new Map<string, Promise<PlayerProps | null>>();

  async function fetchJson(url: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!response.ok) return null;
      if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchProps(league: string, id: string): Promise<PlayerProps | null> {
    const config = LIVE_LEAGUES.find(entry => entry.id === league);
    if (!config || !PROP_SPORTS.has(config.sport)) return null;
    const competitionId = id.split("-")[0];
    const [sport, leaguePath] = config.path.split("/");
    if (!sport || !leaguePath) return null;
    const [propsPayload, summaryPayload] = await Promise.all([
      fetchJson(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${leaguePath}/events/${id}/competitions/${competitionId}/odds/100/propBets?limit=250`),
      fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${config.path}/summary?event=${encodeURIComponent(id)}`),
    ]);
    if (propsPayload === null) return null;
    const props = parseProps(propsPayload, playerNames(summaryPayload));
    if (!props.length) return null;
    return { book: "DraftKings", props, fetchedAt: new Date(now()).toISOString() };
  }

  return {
    async get(league: string, id: string): Promise<PlayerProps | null> {
      if (!/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id)) return null;
      const key = `${league}:${id}`;
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return cached.value;
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const request = fetchProps(league, id)
        .then(value => {
          cache.set(key, { value, expires: now() + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
          if (cache.size > 500) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

const shared = createPlayerPropsClient();
export const getPlayerProps = (league: string, id: string) => shared.get(league, id);
