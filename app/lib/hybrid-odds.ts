import { getLiveEvent } from './live-sports';
import { CircuitBreaker } from './circuit-breaker';
import { matchProviderEvent, type ProviderEventRef } from './event-identity';
import type { GameOdds, LiveEvent } from './live-sports';

// Hybrid odds resolves bookmaker lines for one event. The Odds API is the
// primary bookmaker-odds provider when ODDS_API_KEY is configured; ESPN's
// embedded pick-center prices are the semantically equivalent fallback.
// Prediction-market probabilities (Kalshi) and score feeds are different
// capabilities and are never substituted into the bookmaker-odds chain.
//
// Cache/quota are per serverless instance — see README note in the route.

const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
const BREAKER_KEY = 'the-odds-api';

const SPORT_KEY_MAP: Record<string, string> = {
  nba: 'basketball_nba',
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  epl: 'soccer_epl',
};

export function toOddsApiKey(league: string): string | null {
  return SPORT_KEY_MAP[league.toLowerCase()] ?? null;
}

// ---------- capability registry ----------
// Only providers listed under 'bookmaker-odds' may serve this endpoint.
export type ProviderCapability = 'bookmaker-odds' | 'prediction-market' | 'scores' | 'schedules' | 'player-props';
export type OddsProviderId = 'the-odds-api' | 'espn';
export const PROVIDER_CAPABILITIES: Record<OddsProviderId, readonly ProviderCapability[]> = {
  'the-odds-api': ['bookmaker-odds'],
  espn: ['bookmaker-odds', 'scores', 'schedules', 'player-props'],
};

// ---------- types ----------
export type OddsErrorCategory =
  | 'missing_key' | 'quota_exhausted' | 'unauthorized' | 'rate_limited'
  | 'region_unavailable' | 'network' | 'empty_market' | 'malformed' | 'no_provider';
export type FreshnessState = 'fresh' | 'delayed' | 'expired' | 'unavailable';
export type CacheState = 'hit' | 'miss' | 'stale';

export type OddsFreshness = {
  state: FreshnessState;
  provider: string | null;
  /** Upstream source timestamp when the provider supplies one. */
  sourceAt: string | null;
  fetchedAt: string | null;
  cache: CacheState;
  error: OddsErrorCategory | null;
};

export type HybridOddsResult = {
  eventId: string | null;
  league: string;
  name: string | null;
  startsAt: string | null;
  status: string | null;
  odds: GameOdds | null;
  oddsBooks: GameOdds[];
  provider: string | null;
  source: 'the-odds-api' | 'espn' | null;
  event: LiveEvent | null;
  freshness: OddsFreshness;
};

type OddsApiMarket = {
  id?: string | number;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  /** Provider-side update timestamp; absent means unknown, not "now". */
  last_updated?: string;
  bookmakers?: Array<{
    title?: string;
    markets?: Array<{
      key?: string;
      outcomes?: Array<{ name?: string; price?: number; point?: number }>;
    }>;
  }>;
};

type Env = { ODDS_API_KEY?: string; ODDS_API_DAILY_CREDITS?: string };
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ClientOptions = {
  fetch?: Fetcher;
  now?: () => number;
  env?: Env;
  /** Test hook: override TTLs. */
  ttl?: { liveMs?: number; pregameMs?: number };
  /** Test hook: replace the ESPN detail lookup. */
  getEvent?: (league: string, id: string) => Promise<LiveEvent | null>;
};

// Free tier is ~500 credits/month. The self-imposed daily cap spreads that
// budget conservatively; provider x-requests-* headers remain authoritative.
const DEFAULT_DAILY_CREDITS = 20;
const LIVE_TTL_MS = 60_000;
const PREGAME_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const ODDS_MARKETS = 'h2h,spreads,totals';
const ODDS_REGIONS = 'us';
const ODDS_FORMAT = 'american';
// The Odds API bills markets × regions per request: h2h,spreads,totals × us = 3.
const ODDS_CREDIT_COST = ODDS_MARKETS.split(',').length * ODDS_REGIONS.split(',').length;

const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

// ---------- quota ----------
type QuotaState = {
  day: string;
  used: number;
  /** Self-imposed daily cap exhaustion — resets at UTC midnight. */
  capExhaustedUntil: number;
  /** Provider-reported exhaustion — sticky until headers show credits again. */
  providerExhausted: boolean;
  retryAfterUntil: number;
};

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Tracks The Odds API credit usage from response headers + a daily cap. */
export function createQuotaTracker(options: { now?: () => number; dailyCredits?: number } = {}) {
  const now = options.now ?? Date.now;
  const dailyCredits = Math.max(0, options.dailyCredits ?? DEFAULT_DAILY_CREDITS);
  let state: QuotaState = {
    day: utcDay(now()), used: 0,
    capExhaustedUntil: 0, providerExhausted: false, retryAfterUntil: 0,
  };

  function rollDay() {
    const day = utcDay(now());
    if (state.day !== day) {
      state.day = day;
      state.used = 0;
      state.capExhaustedUntil = 0;
      // providerExhausted deliberately survives the day boundary: the
      // provider's quota window is not guaranteed to be a UTC day.
    }
  }

  const nextMidnight = () => Date.parse(`${utcDay(now() + 86_400_000)}T00:00:00Z`);

  return {
    /**
     * Atomically reserve `cost` credits before calling upstream. The
     * reservation increments `used` synchronously, so concurrent callers
     * cannot all pass a nearly-empty budget. False when exhausted.
     */
    allow(cost = 1): boolean {
      rollDay();
      if (state.providerExhausted || now() < state.capExhaustedUntil || now() < state.retryAfterUntil) return false;
      if (dailyCredits > 0 && state.used + cost > dailyCredits) {
        state.capExhaustedUntil = nextMidnight();
        return false;
      }
      state.used += cost;
      return true;
    },
    /** Honor a provider Retry-After hint by idling upstream calls. */
    noteRetryAfter(seconds: number) {
      if (Number.isFinite(seconds) && seconds > 0) {
        state.retryAfterUntil = Math.max(state.retryAfterUntil, now() + seconds * 1000);
      }
    },
    /**
     * Reconcile with provider headers after a call. `allow()` already
     * reserved the credit, so usage is never double-counted: provider
     * headers can only raise the observed total, and a positive
     * x-requests-remaining clears provider-reported exhaustion.
     */
    observe(headers: Headers | null) {
      rollDay();
      const headerNum = (name: string) => {
        const raw = headers?.get(name);
        return raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      };
      const remaining = headerNum('x-requests-remaining');
      const usedHeader = headerNum('x-requests-used');
      if (Number.isFinite(usedHeader) && usedHeader >= 0) {
        state.used = Math.max(state.used, usedHeader);
      }
      if (Number.isFinite(remaining)) {
        if (remaining <= 0) {
          // Provider says the quota is gone — sticky until it reports
          // credits again; its reset window is not assumed to be a UTC day.
          state.providerExhausted = true;
        } else {
          state.providerExhausted = false;
        }
      }
      if (dailyCredits > 0 && state.used >= dailyCredits) {
        state.capExhaustedUntil = nextMidnight();
      }
      return { used: state.used, remaining: Number.isFinite(remaining) ? remaining : null };
    },
    snapshot() {
      rollDay();
      return {
        day: state.day, used: state.used, dailyCredits,
        exhausted: state.providerExhausted || now() < state.capExhaustedUntil,
      };
    },
  };
}

// ---------- mapping ----------
// The Odds API outcomes are name-keyed per event; the event supplies team names.
function mapOddsApiEventToOddsBooks(event: OddsApiMarket): GameOdds[] {
  const homeName = event.home_team ?? '';
  const awayName = event.away_team ?? '';
  const books: GameOdds[] = [];
  for (const bookmaker of (event.bookmakers ?? []).slice(0, 8)) {
    const markets = bookmaker.markets ?? [];
    const h2h = markets.find(m => m.key === 'h2h');
    const spreads = markets.find(m => m.key === 'spreads');
    const totals = markets.find(m => m.key === 'totals');
    const pick = (market: any, name: string) => market?.outcomes?.find((o: any) => o.name === name);
    const homeMl = pick(h2h, homeName);
    const awayMl = pick(h2h, awayName);
    const drawMl = pick(h2h, 'Draw');
    const homeSpread = pick(spreads, homeName);
    const awaySpread = pick(spreads, awayName);
    const over = pick(totals, 'Over');
    const under = pick(totals, 'Under');
    const anyPrice = [homeMl, awayMl, homeSpread, awaySpread, over, under]
      .some(o => typeof o?.price === 'number');
    if (!anyPrice) continue;
    books.push({
      provider: bookmaker.title ?? 'the-odds-api',
      spread: homeSpread?.point ?? null,
      total: over?.point ?? null,
      homeMoneyline: homeMl?.price ?? null,
      awayMoneyline: awayMl?.price ?? null,
      drawMoneyline: drawMl?.price ?? null,
      homeSpreadPrice: homeSpread?.price ?? null,
      awaySpreadPrice: awaySpread?.price ?? null,
      overPrice: over?.price ?? null,
      underPrice: under?.price ?? null,
      openSpread: null, openTotal: null,
      openHomeMoneyline: null, openAwayMoneyline: null, openDrawMoneyline: null,
      favorite: typeof homeMl?.price === 'number' && typeof awayMl?.price === 'number'
        ? (homeMl.price < awayMl.price ? 'home' : 'away') : null,
    });
  }
  return books;
}

// ---------- client ----------
export function createHybridOddsClient(options: ClientOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const liveTtl = options.ttl?.liveMs ?? LIVE_TTL_MS;
  const pregameTtl = options.ttl?.pregameMs ?? PREGAME_TTL_MS;
  const apiKey = env.ODDS_API_KEY;
  const getEvent = options.getEvent ?? getLiveEvent;
  const dailyCredits = Number(env.ODDS_API_DAILY_CREDITS) || DEFAULT_DAILY_CREDITS;
  const quota = createQuotaTracker({ now, dailyCredits });
  const clientBreaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, now });
  const clientBreakerKey = 'the-odds-api';

  // One upstream call returns every event for a sport, so the cache key is the
  // full request signature — provider, sport, market set, region, format —
  // never just league:event. This is what actually saves quota.
  type BoardResult = { payload: OddsApiMarket[] | null; error: OddsErrorCategory | null; cache: CacheState };
  const cache = new Map<string, { payload: OddsApiMarket[] | null; error: OddsErrorCategory | null; fetchedAt: number; expiresAt: number }>();
  const pending = new Map<string, Promise<BoardResult>>();

  function cacheKey(sportKey: string): string {
    return ['toa', sportKey, ODDS_REGIONS, ODDS_MARKETS, ODDS_FORMAT].join('|');
  }

  function remember(key: string, entry: { payload: OddsApiMarket[] | null; error: OddsErrorCategory | null; fetchedAt: number; expiresAt: number }) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, entry);
  }

  async function fetchSportBoard(sportKey: string): Promise<BoardResult> {
    const key = cacheKey(sportKey);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      return { payload: cached.payload, error: cached.error, cache: 'hit' };
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const request = (async (): Promise<BoardResult> => {
      if (!apiKey) return { payload: null, error: 'missing_key', cache: 'miss' };
      // Breaker first: an open breaker must not burn a quota reservation.
      if (!clientBreaker.allow(clientBreakerKey)) {
        return { payload: null, error: 'no_provider', cache: 'miss' };
      }
      // allow() reserves the credit atomically before the fetch is issued.
      if (!quota.allow(ODDS_CREDIT_COST)) return { payload: null, error: 'quota_exhausted', cache: 'miss' };
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=${ODDS_REGIONS}&markets=${ODDS_MARKETS}&oddsFormat=${ODDS_FORMAT}`;
      try {
        const res = await fetcher(url);
        quota.observe(res.headers);
        if (res.status === 401 || res.status === 403) {
          clientBreaker.failure(clientBreakerKey);
          return { payload: null, error: 'unauthorized', cache: 'miss' };
        }
        if (res.status === 429) {
          clientBreaker.failure(clientBreakerKey);
          quota.noteRetryAfter(Number(res.headers.get('retry-after')));
          return { payload: null, error: 'rate_limited', cache: 'miss' };
        }
        if (res.status === 451) return { payload: null, error: 'region_unavailable', cache: 'miss' };
        if (!res.ok) {
          clientBreaker.failure(clientBreakerKey);
          return { payload: null, error: 'network', cache: 'miss' };
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          await res.body?.cancel().catch(() => undefined);
          return { payload: null, error: 'malformed', cache: 'miss' };
        }
        const data = await res.json();
        if (!Array.isArray(data)) return { payload: null, error: 'malformed', cache: 'miss' };
        clientBreaker.success(clientBreakerKey);
        // Empty board is a valid market state, not an error.
        const hasLive = data.some((e: OddsApiMarket) =>
          typeof e.commence_time === 'string' && Date.parse(e.commence_time) <= now());
        const ttl = hasLive ? liveTtl : pregameTtl;
        remember(key, {
          payload: data as OddsApiMarket[], error: null,
          fetchedAt: now(), expiresAt: now() + ttl,
        });
        return { payload: data as OddsApiMarket[], error: null, cache: 'miss' };
      } catch {
        clientBreaker.failure(clientBreakerKey);
        return { payload: null, error: 'network', cache: 'miss' };
      }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function freshnessFor(
    state: FreshnessState, provider: string | null,
    sourceAt: number | string | null, fetchedAt: number | null,
    cache: CacheState, error: OddsErrorCategory | null,
  ): OddsFreshness {
    // Provider timestamps pass through verbatim when they parse — re-serializing
    // would rewrite '...Z' to '....000Z' and break string equality for clients.
    const sourceIso = sourceAt === null ? null
      : typeof sourceAt === 'number' ? new Date(sourceAt).toISOString()
      : typeof sourceAt === 'string' && Number.isFinite(Date.parse(sourceAt)) ? sourceAt.trim() : null;
    return {
      state, provider,
      sourceAt: sourceIso,
      fetchedAt: fetchedAt !== null ? new Date(fetchedAt).toISOString() : null,
      cache, error,
    };
  }

  async function fetchWithFallback(league: string, id: string): Promise<HybridOddsResult> {
    const sportKey = toOddsApiKey(league);
    const base = {
      eventId: id, league, name: null, startsAt: null, status: null,
      odds: null, oddsBooks: [] as GameOdds[], provider: null,
      source: null as HybridOddsResult['source'], event: null as LiveEvent | null,
    };

    // Resolve the canonical ESPN event first — it supplies the identity
    // (team names + start) used to safely match provider odds boards, and it
    // is also the fallback payload when the primary provider can't serve.
    let espnEvent: LiveEvent | null = null;
    try {
      espnEvent = await getEvent(league, id);
    } catch {
      espnEvent = null;
    }

    // Primary: The Odds API (bookmaker-odds capability only). Provider event
    // ids are opaque and never equal ESPN ids, so matching goes through the
    // canonical identity layer: both team names + commence window must agree.
    if (sportKey && apiKey && espnEvent) {
      const { payload, error, cache: cacheState } = await fetchSportBoard(sportKey);
      const refs: ProviderEventRef[] = (payload ?? []).map(e => ({
        provider: 'the-odds-api',
        providerId: String(e.id ?? ''),
        homeName: e.home_team ?? '',
        awayName: e.away_team ?? '',
        startsAt: e.commence_time ?? null,
      }));
      const match = matchProviderEvent(refs, {
        canonicalId: espnEvent.id,
        league,
        homeName: espnEvent.home.name,
        awayName: espnEvent.away.name,
        startsAt: espnEvent.startsAt,
      });
      const matched = match ? payload!.find(e => String(e.id) === match.ref.providerId) ?? null : null;
      if (matched) {
        const oddsBooks = mapOddsApiEventToOddsBooks(matched);
        const primary = oddsBooks[0] ?? null;
        if (primary) {
          return {
            ...base,
            eventId: espnEvent.id,
            name: espnEvent.name,
            startsAt: espnEvent.startsAt,
            status: espnEvent.status,
            odds: primary,
            oddsBooks,
            provider: primary.provider,
            source: 'the-odds-api',
            event: espnEvent,
            freshness: freshnessFor('fresh', 'the-odds-api', matched.last_updated ?? null, now(), cacheState, null),
          };
        }
      }
      if (payload && payload.length === 0) {
        // Valid empty market: fall through to ESPN but record the category.
        return espnResult(espnEvent, base, 'empty_market', cacheState);
      }
      return espnResult(espnEvent, base, error ?? 'no_provider', cacheState);
    }

    return espnResult(espnEvent, base, apiKey ? 'no_provider' : 'missing_key', 'miss');
  }

  function espnResult(
    event: LiveEvent | null,
    base: Omit<HybridOddsResult, 'freshness'>,
    error: OddsErrorCategory | null,
    cache: CacheState = 'miss',
  ): HybridOddsResult {
    if (event) {
      return {
        ...base,
        eventId: event.id,
        name: event.name,
        startsAt: event.startsAt,
        status: event.status,
        odds: event.odds ?? null,
        oddsBooks: event.oddsBooks ?? [],
        provider: event.odds?.provider ?? null,
        source: 'espn',
        event,
        freshness: freshnessFor('fresh', 'espn', null, now(), cache, error),
      };
    }
    return {
      ...base,
      freshness: freshnessFor('unavailable', null, null, null, cache, error ?? 'no_provider'),
    };
  }

  return {
    fetchOddsWithFallback: fetchWithFallback,
    quota: () => quota.snapshot(),
    /** Test hook: inspect cache occupancy. */
    cacheSize: () => cache.size,
  };
}

const shared = createHybridOddsClient();
export const fetchOddsWithFallback = (league: string, id: string) => shared.fetchOddsWithFallback(league, id);
export const oddsQuota = () => shared.quota();
export { breaker as oddsCircuitBreaker };
