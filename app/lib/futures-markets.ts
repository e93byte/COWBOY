import { LIVE_LEAGUES } from "./sports-leagues";

// Futures context shows what prediction markets imply about season-long
// outcomes (championships, awards). Kalshi prices are dollar probabilities;
// they are display-only reference context, never a wager.
export type FuturesOutcome = { name: string; probability: number };
export type FuturesBoard = { title: string; outcomes: FuturesOutcome[] };
export type LeagueFutures = { book: "Kalshi"; boards: FuturesBoard[]; fetchedAt: string };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = { fetch?: Fetcher; now?: () => number; timeoutMs?: number };

const SERIES_TTL_MS = 10 * 60_000;
const LEAGUE_TTL_MS = 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_SERIES_PER_LEAGUE = 24;
const MAX_SERIES_PAGES = 24;
const MAX_BOARDS = 3;
const MAX_BOARD_OUTCOMES = 10;
const EVENTS_PER_SERIES = 20;
const SERIES_FETCH_CONCURRENCY = 3;
const SERIES_FETCH_GAP_MS = 250;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";

const API = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi organizes series by ticker prefix (KXMLB*=MLB, KXEPL*=EPL) while
// titles are often generic ("Correct Score", "Spread"). Rules match on ticker
// prefix OR title terms; `needTag`/`exclude` apply to the series title.
type LeagueRule = { tickers?: RegExp; roots?: string[]; terms?: string[]; needTag?: string; exclude?: RegExp };
const RULES: Record<string, LeagueRule> = {
  nfl: { roots: ['KXSB', 'KXTEAMSINSB'], tickers: /^KXNFL|^KXSUPERBOWL|^KXSB/, terms: ["pro football", "super bowl", "nfl"], exclude: /fantasy|college|ncaaf|arena|xfl|ufl/ },
  ncaaf: { roots: ['KXNCAAF'], tickers: /^KXNCAAF/, terms: ["ncaaf", "college football", "cfp"], exclude: /basketball|baseball|women/ },
  nba: { roots: ['KXNBA'], tickers: /^KXNBA/, terms: ["nba", "pro basketball"], exclude: /women|wnba|college|ncaaw/ },
  wnba: { roots: ['KXWNBA'], tickers: /^KXWNBA/, terms: ["wnba", "women's pro basketball", "womens pro basketball"] },
  ncaab: { roots: ['KXMARMAD', 'KXMARMADREGION', 'KXMARMADCONFWIN'], tickers: /^KXNCAAMB/, terms: ["men's college basketball", "college basketball", "ncaa basketball", "march madness", "ncaab"], exclude: /women|wnba|ncaaw|baseball|football|high school/ },
  mlb: { roots: ['KXMLB', 'KXMLBWS', 'KXMLBWSOUTCOME'], tickers: /^KXMLB/, terms: ["mlb", "pro baseball", "world series"], exclude: /basketball|football|hockey|classic|softball/ },
  nhl: { roots: ['KXNHL', 'KXTEAMSINSC'], tickers: /^KXNHL/, terms: ["nhl", "stanley cup"], exclude: /olympic|winter olympic|iihf/ },
  epl: { roots: ['KXPREMIERLEAGUE', 'KXEPLTOP', 'KXEPLTOP4', 'KXEPLRELEGATION'], tickers: /^KXEPL|^KXPREMIERLEAGUE/, terms: ["english premier league", "premier league", "epl"], needTag: "Soccer", exclude: /darts|rugby|a-league|super league|russia|belg|scot|turk|egypt|ukrain|israel|caribbean|australia|south africa|china|japan|korea|india|denmark|norway|sweden|finland|netherlands|portugal|greece|cyprus|malta|qatar|saudi|emirates|bahrain|oman|kuwait|jordan|lebanon|iran|iraq|pakistan|bangladesh|sri lanka|nepal|kazakhstan|uzbekistan|georgia|armenia|azerbaijan|belarus|moldova|romania|bulgaria|serbia|croatia|slovenia|slovakia|czech|poland|hungary|austria|switzerland|italy|spain|france|germany|mexico|brazil|argentina|chile|colombia|peru|uruguay|paraguay|ecuador|venezuela|bolivia|panama|costa rica|honduras|guatemala|nicaragua|jamaica|trinidad|bahamas|barbados|puerto rico|dominican|haiti|cuba|canada|usa/ },
  efl: { roots: ['KXEFLCHAMPIONSHIP'], tickers: /^KXEFL/, terms: ["efl"], needTag: "Soccer", exclude: /darts|rugby|nrl/ },
  laliga: { roots: ['KXLALIGA'], tickers: /^KXLALIGA|^KXNEXTMANAGERLALIGA/, terms: ["la liga", "laliga", "spanish la liga"], needTag: "Soccer" },
  seriea: { roots: ['KXSERIEA'], tickers: /^KXSERIEA/, terms: ["serie a", "italian serie a"], needTag: "Soccer" },
  bundesliga: { roots: ['KXBUNDESLIGA'], tickers: /^KXBUNDESLIGA(?!2|W|3)/, terms: ["bundesliga"], needTag: "Soccer", exclude: /austria|2\.|3\.|women/ },
  bl2: { tickers: /^KXBUNDESLIGA2/, terms: ["bundesliga 2", "2. bundesliga"], needTag: "Soccer" },
  bl3: { tickers: /^KX3\.?LIGA|^KXBL3|^KXREGIONALIGA/, terms: ["3. liga"], needTag: "Soccer" },
  ligue1: { roots: ['KXLIGUE1'], tickers: /^KXLIGUE1/, terms: ["ligue 1", "french ligue 1"], needTag: "Soccer" },
  ligue2: { tickers: /^KXLIGUE2/, terms: ["ligue 2", "french ligue 2"], needTag: "Soccer" },
  mls: { roots: ['KXMLSCUP', 'KXMLS'], tickers: /^KXMLS/, terms: ["mls", "major league soccer"], needTag: "Soccer", exclude: /mexico|liga mx/ },
  ucl: { roots: ['KXUCL'], tickers: /^KXUCL|^KXUEFACL|^KXTEAMSINUCL/, terms: ["champions league", "ucl"], needTag: "Soccer", exclude: /hockey|womens|wsl/ },
  nationsleague: { roots: ['KXUEFANL'], tickers: /^KXUEFANL|^KXCONCACAFNL/, terms: ["nations league", "uefa nations"], needTag: "Soccer" },
  concacafnl: { tickers: /^KXCONCACAFNL/, terms: ["concacaf nations"], needTag: "Soccer" },
  afconqual: { terms: ["africa cup", "afcon", "african cup of nations"], needTag: "Soccer" },
  nwsl: { terms: ["nwsl"], needTag: "Soccer" },
  wsl: { terms: ["women's super league", "wsl"], needTag: "Soccer", exclude: /us |usa|nwsl/ },
  ligamx: { roots: ['KXLIGAMX'], tickers: /^KXLIGAMX/, terms: ["liga mx"], needTag: "Soccer" },
  argentina: { tickers: /^KXARGPREM|^KXARGENTINA|^KXLIGAARG/, terms: ["argentina", "liga profesional"], needTag: "Soccer" },
  brasileirao: { roots: ['KXBRASILEIRO'], tickers: /^KXBRASILEIRO/, terms: ["brasileir", "brazil serie a", "campeonato brasileiro"], needTag: "Soccer" },
  aleague: { tickers: /^KXALEAGUE|^KXA-LEAGUE/, terms: ["a-league", "a league"], needTag: "Soccer", exclude: /australian football|afl|australian rules|rugby|super rugby|nrl/ },
  facup: { roots: ['KXFACUP'], tickers: /^KXFACUP|^KXFA.CUP/, terms: ["fa cup"], needTag: "Soccer" },
  dfb_pokal: { roots: ['KXDFBPOKAL'], tickers: /^KXDFBPOKAL/, terms: ["dfb-pokal", "dfb pokal"], needTag: "Soccer" },
  atp: { roots: ['KXATPFINALS'], tickers: /^KXATP/, terms: ["atp", "wimbledon", "grand slam"], needTag: "Tennis" },
  wta: { roots: ['KXWTAGRANDSLAM', 'KXATPFINALS'], tickers: /^KXWTA/, terms: ["wta", "wimbledon", "grand slam"], needTag: "Tennis" },
  ufc: { roots: ['KXUFCTITLE', 'KXUFCHEAVYWEIGHTTITLE'], tickers: /^KXUFC|^KXKXUFC/, terms: ["ufc"], needTag: "MMA", exclude: /boxing|kickboxing/ },
  bellator: { tickers: /^KXBELLATOR/, terms: ["bellator"], needTag: "MMA" },
  pfl: { tickers: /^KXPFL/, terms: ["pfl"], needTag: "MMA" },
  premrugby: { tickers: /^KXPREG|^KXENGNRUGBY|^KXRUGBYPREM/, terms: ["premiership rugby", "english premiership", "guinness premiership"], needTag: "Rugby", exclude: /league|united/ },
  top14: { tickers: /^KXTOP14/, terms: ["top 14", "top14"], needTag: "Rugby" },
  championsrugby: { tickers: /^KXCHAMPIONSCUP|^KXERC|^KXRUGBYCHAMPIONSCUP|^KXEUROPACUP/, terms: ["champions cup", "european rugby champions", "european champions cup"], needTag: "Rugby" },
  nrl: { roots: ['KXNRL'], tickers: /^KXNRL/, terms: ["nrl", "national rugby league", "rugby league"], exclude: /union|super rugby|a-league|australian rules/ },
  afl: { tickers: /^KXAFL/, terms: ["afl", "australian football", "australian rules"], exclude: /rugby|nrl|league/ },
  nll: { tickers: /^KXNLL/, terms: ["nll", "national lacrosse"], needTag: "Lacrosse" },
  pll: { roots: ['KXPLL'], tickers: /^KXPLL/, terms: ["pll"], needTag: "Lacrosse" },
  pga: { roots: ['KXPGA', 'KXGOLF', 'KXPGAMAJORWIN'], tickers: /^KXPGA|^KXGOLF|^KXLIV|^KXTHEOPEN|^KXMASTERS|^KXRYDER|^KXUSOPEN/, terms: ["pga", "golf", "masters", "ryder cup"], needTag: "Golf", exclude: /liv|lpga|european tour|dp world|champions tour|seniors/ },
};

// Series/event titles that look like outright markets get fetched first.
const OUTRIGHT_SERIES_RE = /winner|champion|title|mvp|award|leader|futures|odds|playoff|final|conference|division|relegation|points|wins|scorer|race|top|who will|seed|draft|rookie|all-|team|coach|next|record|streak|unbeaten|invict|undefeated|promot|qualif|advance|group|outright|finish|place|position|rank|standing|table|cy young|heisman|outcome|royalty/;
const STRONG_SERIES_RE = /winner|champion|title|mvp|award|leader|futures|odds|race to|who will|final|conference|division|relegation|\bcup\b|playoff/;
// Championship/outright boards must outrank large prop boards regardless of
// how many outcomes each carries.
const FLAGSHIP_SERIES_RE = /champion|to win|winner|hoist|title/i;
// Per-game events have exactly two markets and "A vs B" titles; outright
// boards carry many outcome markets. Both checks keep game lines out.
const GAME_EVENT_RE = /\bvs\.?\b|\bgame\b|\bmatch\b|\bhalf\b|quarter|period|inning|\bset\b|\bmap\b/;
const MAX_EVENT_MARKETS_OUTRIGHT = 2;

type KalshiMarket = {
  ticker?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  last_price_dollars?: string;
  status?: string;
};
type KalshiEvent = {
  event_ticker?: string;
  title?: string;
  sub_title?: string;
  markets?: KalshiMarket[];
};
type KalshiSeries = { ticker?: string; title?: string; category?: string; tags?: string[] };
type KalshiFeed = { cursor?: string; events?: KalshiEvent[]; series?: KalshiSeries[] };

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const lower = (value: unknown) => String(value ?? "").toLowerCase();

function matchesRule(rule: LeagueRule, series: KalshiSeries): boolean {
  const title = lower(series.title);
  if (rule.exclude?.test(title)) return false;
  if (rule.needTag && !(series.tags ?? []).some(tag => lower(tag) === lower(rule.needTag))) return false;
  if (rule.tickers?.test(series.ticker ?? "")) return true;
  const haystack = `${title} ${lower((series.tags ?? []).join(" "))}`;
  return (rule.terms ?? []).some(term => haystack.includes(lower(term)));
}

function yesProbability(market: KalshiMarket): number | null {
  if (market.status && market.status !== "active" && market.status !== "open") return null;
  const raw = market.yes_ask_dollars ?? market.last_price_dollars ?? market.yes_bid_dollars;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

function outcomeName(market: KalshiMarket): string {
  return (market.yes_sub_title || market.subtitle || market.title || market.ticker || "").trim().slice(0, 80);
}

export function createFuturesClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  let seriesFeed: { at: number; series: KalshiSeries[]; pending?: Promise<KalshiSeries[]> } = { at: 0, series: [] };
  const leagueCache = new Map<string, { value: LeagueFutures | null; expires: number }>();
  const leaguePending = new Map<string, Promise<LeagueFutures | null>>();

  async function fetchJson(url: string): Promise<KalshiFeed | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, {
          cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => undefined);
          const retryAfter = Number(response.headers.get("retry-after"));
          const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400, 2000) * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, wait));
          continue;
        }
        if (!response.ok) return null;
        if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
          await response.body?.cancel().catch(() => undefined);
          return null;
        }
        return await response.json() as KalshiFeed;
      } catch {
        if (attempt === 1) return null;
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  async function loadSeries(): Promise<KalshiSeries[]> {
    if (seriesFeed.series.length && now() - seriesFeed.at < SERIES_TTL_MS) return seriesFeed.series;
    if (seriesFeed.pending) return seriesFeed.pending;
    seriesFeed.pending = (async () => {
      const series: KalshiSeries[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_SERIES_PAGES; page++) {
        const url = new URL(`${API}/series`);
        url.searchParams.set("limit", "200");
        url.searchParams.set("category", "Sports");
        if (cursor) url.searchParams.set("cursor", cursor);
        const payload = await fetchJson(url.toString());
        if (!payload) break;
        series.push(...(payload.series ?? []));
        cursor = payload.cursor;
        if (!cursor) break;
      }
      seriesFeed.series = series.filter(item => item.ticker);
      seriesFeed.at = now();
      return seriesFeed.series;
    })();
    try {
      return await seriesFeed.pending;
    } finally {
      seriesFeed.pending = undefined;
    }
  }

  async function loadBoards(ticker: string): Promise<FuturesBoard[]> {
    const url = new URL(`${API}/events`);
    url.searchParams.set("series_ticker", ticker);
    url.searchParams.set("limit", String(EVENTS_PER_SERIES));
    url.searchParams.set("status", "open");
    url.searchParams.set("with_nested_markets", "true");
    const payload = await fetchJson(url.toString());
    if (!payload) return [];
    const boards: FuturesBoard[] = [];
    for (const event of payload.events ?? []) {
      const title = (event.title ?? "").trim();
      const markets = (event.markets ?? []).filter(market => yesProbability(market) !== null);
      // Outright boards carry many outcomes; head-to-head events carry two.
      if (!title || markets.length <= MAX_EVENT_MARKETS_OUTRIGHT || GAME_EVENT_RE.test(title)) continue;
      const seenNames = new Set<string>();
      const outcomes: FuturesOutcome[] = [];
      for (const market of markets) {
        const name = outcomeName(market);
        const probability = yesProbability(market);
        if (!name || probability === null || seenNames.has(name)) continue;
        seenNames.add(name);
        outcomes.push({ name, probability: Math.round(probability * 1000) / 1000 });
      }
      if (outcomes.length >= 2) {
        outcomes.sort((a, b) => b.probability - a.probability);
        boards.push({ title: title.slice(0, 90), outcomes });
      }
    }
    return boards;
  }

  return {
    async get(league: string): Promise<LeagueFutures | null> {
      const rule = RULES[league];
      if (!LIVE_LEAGUES.some(config => config.id === league) || !rule) return null;
      const cached = leagueCache.get(league);
      if (cached && cached.expires > now()) return cached.value;
      const inFlight = leaguePending.get(league);
      if (inFlight) return inFlight;
      const request = (async () => {
        const rootTickers = rule.roots ?? [];
        const boards = new Map<string, FuturesBoard>();
        const collect = (batch: FuturesBoard[]) => {
          for (const board of batch) {
            const key = board.title.toLowerCase();
            const existing = boards.get(key);
            if (!existing || board.outcomes.length > existing.outcomes.length) boards.set(key, board);
          }
        };
        // Flagship championship/outright series are fetched by ticker directly.
        // Requiring them to appear in the paginated series directory made the
        // board slow and occasionally dropped the championship market entirely.
        for (let i = 0; i < rootTickers.length; i += SERIES_FETCH_CONCURRENCY) {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, SERIES_FETCH_GAP_MS));
          collect((await Promise.all(
            rootTickers.slice(i, i + SERIES_FETCH_CONCURRENCY).map(ticker => loadBoards(ticker)))).flat());
        }
        // Generic series only matter when the flagship roots did not fill the
        // board. The common case is one or two provider requests.
        if (boards.size < MAX_BOARDS) {
          const series = await loadSeries();
          const sportsSeries = series.filter(item => lower(item.category) === "sports" && item.ticker);
          const rootSet = new Set(rootTickers);
          const matched = sportsSeries
            .filter(item => !rootSet.has(item.ticker!) && matchesRule(rule, item))
            .sort((a, b) =>
              Number(STRONG_SERIES_RE.test(b.title ?? "")) - Number(STRONG_SERIES_RE.test(a.title ?? "")) ||
              Number(OUTRIGHT_SERIES_RE.test(b.title ?? "")) - Number(OUTRIGHT_SERIES_RE.test(a.title ?? "")))
            .slice(0, Math.max(0, MAX_SERIES_PER_LEAGUE - rootTickers.length));
          // Kalshi throttles bursts; fetch series events in small batches.
          for (let i = 0; i < matched.length; i += SERIES_FETCH_CONCURRENCY) {
            if (i > 0) await new Promise(resolve => setTimeout(resolve, SERIES_FETCH_GAP_MS));
            collect((await Promise.all(
              matched.slice(i, i + SERIES_FETCH_CONCURRENCY).map(item => loadBoards(item.ticker!)))).flat());
            // Matched series are already sorted strongest-first; stop once the
            // board has enough candidates instead of probing every series.
            if (boards.size >= MAX_BOARDS * 2) break;
          }
        }
        const ranked = [...boards.values()]
          .sort((a, b) =>
            Number(FLAGSHIP_SERIES_RE.test(b.title)) - Number(FLAGSHIP_SERIES_RE.test(a.title)) ||
            Number(STRONG_SERIES_RE.test(b.title)) - Number(STRONG_SERIES_RE.test(a.title)) ||
            Number(/qualifier|to advance|advancing/i.test(a.title)) - Number(/qualifier|to advance|advancing/i.test(b.title)) ||
            b.outcomes.length - a.outcomes.length)
          .slice(0, MAX_BOARDS)
          .map(board => ({ ...board, outcomes: board.outcomes.slice(0, MAX_BOARD_OUTCOMES) }));
        const value = ranked.length
          ? { book: "Kalshi" as const, boards: ranked, fetchedAt: new Date(now()).toISOString() }
          : null;
        leagueCache.set(league, { value, expires: now() + (value ? LEAGUE_TTL_MS : FAILURE_TTL_MS) });
        return value;
      })()
        .catch(() => {
          leagueCache.set(league, { value: null, expires: now() + FAILURE_TTL_MS });
          return null;
        })
        .finally(() => leaguePending.delete(league));
      leaguePending.set(league, request);
      return request;
    },
  };
}

const shared = createFuturesClient();
export const getLeagueFutures = (league: string) => shared.get(league);
