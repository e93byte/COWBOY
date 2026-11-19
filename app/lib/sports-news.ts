import { LIVE_LEAGUES } from "./sports-leagues";

// League news previews come from ESPN's public site API. Headlines link out to
// ESPN; we only carry title, summary, timestamp and URL — never article bodies.
export type NewsArticle = {
  id: string;
  headline: string;
  description: string;
  publishedAt: string;
  url: string;
  category: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SUCCESS_TTL_MS = 15 * 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_ARTICLES = 8;
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, max = 300): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";

function parseArticles(payload: unknown): NewsArticle[] {
  const articles = Array.isArray(object(payload).articles) ? object(payload).articles as unknown[] : [];
  const out: NewsArticle[] = [];
  for (const raw of articles) {
    const item = object(raw);
    const headline = text(item.headline, 200);
    const url = text(object(item.links).web && object(object(item.links).web).href, 500);
    const publishedAt = text(item.published, 40);
    if (!headline || !url || !publishedAt || !/^https:\/\//.test(url)) continue;
    const category = Array.isArray(item.categories)
      ? text(object(item.categories[0]).description, 60) : "";
    out.push({
      id: text(item.id, 40) || url,
      headline,
      description: text(item.description, 240),
      publishedAt,
      url,
      category,
    });
    if (out.length >= MAX_ARTICLES) break;
  }
  return out;
}

export function createSportsNewsClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const cache = new Map<string, { articles: NewsArticle[] | null; expires: number }>();
  const pending = new Map<string, Promise<NewsArticle[]>>();

  async function fetchNews(league: string): Promise<NewsArticle[] | null> {
    const config = LIVE_LEAGUES.find(entry => entry.id === league && entry.sport !== "golf" && entry.sport !== "mma");
    if (!config) return null;
    const [sport, leaguePath] = config.path.split("/");
    if (!sport || !leaguePath) return null;
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leaguePath}/news?limit=20`;
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
      return parseArticles(payload);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async get(league: string): Promise<NewsArticle[]> {
      const config = LIVE_LEAGUES.find(entry => entry.id === league);
      if (!config) return [];
      const key = league;
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return cached.articles ?? [];
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const request = fetchNews(league)
        .then(articles => {
          cache.set(key, { articles, expires: now() + (articles && articles.length ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
          if (cache.size > 200) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          return articles ?? [];
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

const shared = createSportsNewsClient();
export const getSportsNews = (league: string) => shared.get(league);
