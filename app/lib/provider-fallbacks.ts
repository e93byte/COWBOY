import type { LiveEvent } from './live-sports';

type RecordLike = Record<string, any>;

const object = (value: unknown): RecordLike =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {};
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

function scoreOf(value: unknown, scheduled: boolean): number | null {
  if (scheduled || value === undefined || value === null || value === '' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusOf(code: string): LiveEvent['status'] {
  const normalized = code.toUpperCase();
  if (['FT', 'AET', 'AP', 'AWD', 'WO'].includes(normalized)) return 'final';
  if (['PP', 'PST', 'POSTP', 'SUSP', 'INT'].includes(normalized)) return 'postponed';
  if (['CANC', 'ABD', 'DEL'].includes(normalized)) return 'cancelled';
  if (!normalized || normalized === 'NS') return 'scheduled';
  return 'live';
}

function startTimeOf(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
  if (digits.length !== 14) return null;
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeHttps(value: unknown): string | undefined {
  const raw = text(value);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch { return undefined; }
}

function winnerFor(status: LiveEvent['status'], away: number | null, home: number | null): LiveEvent['winner'] {
  if (status !== 'final' || away === null || home === null || away === home) return status === 'final' ? 'draw' : null;
  return home > away ? 'home' : 'away';
}

function completeFor(status: LiveEvent['status']): boolean {
  return status === 'final';
}

/** Normalize the public LiveScore payload used by the source repo's soccer adapter. */
export function normalizeLiveScorePayload(
  league: string,
  leagueName: string,
  payload: unknown,
): LiveEvent[] {
  const stages = Array.isArray(object(payload).Stages) ? object(payload).Stages.map(object) : [];
  const out: LiveEvent[] = [];
  const seen = new Set<string>();
  for (const stage of stages) {
    const events = Array.isArray(stage.Events) ? stage.Events.map(object) : [];
    const competition = text(stage.CompN || stage.Snm || stage.Cnm);
    if (!competition) continue;
    for (const raw of events) {
      const rawId = text(raw.Eid);
      const home = object(Array.isArray(raw.T1) ? raw.T1[0] : undefined);
      const away = object(Array.isArray(raw.T2) ? raw.T2[0] : undefined);
      const homeName = text(home.Nm);
      const awayName = text(away.Nm);
      const homeId = text(home.ID);
      const awayId = text(away.ID);
      const startsAt = startTimeOf(raw.Esd);
      if (!rawId || seen.has(rawId) || !homeId || !awayId || !homeName || !awayName || !startsAt) continue;
      const status = statusOf(text(raw.Eps));
      const homeScore = scoreOf(raw.Tr1, status === 'scheduled');
      const awayScore = scoreOf(raw.Tr2, status === 'scheduled');
      seen.add(rawId);
      out.push({
        id: rawId,
        league,
        sport: 'soccer',
        leagueName,
        name: `${awayName} at ${homeName}`,
        startsAt,
        status,
        statusText: text(raw.Eps || raw.ErnInf) || (status === 'scheduled' ? 'Scheduled' : 'In progress'),
        clock: null,
        period: null,
        home: { id: homeId, name: homeName, shortName: text(home.Abr) || homeName, score: homeScore },
        away: { id: awayId, name: awayName, shortName: text(away.Abr) || awayName, score: awayScore },
        scoreSource: 'LiveScore',
        winner: winnerFor(status, awayScore, homeScore),
        completed: completeFor(status),
      });
    }
  }
  return out;
}

/** Normalize OpenLigaDB matches used as the Bundesliga fallback. */
export function normalizeOpenLigaPayload(
  league: string,
  leagueName: string,
  payload: unknown,
  now = Date.now(),
): LiveEvent[] {
  const matches = Array.isArray(payload) ? payload.map(object) : [];
  return matches.flatMap((match) => {
    const id = text(match.matchID);
    const startsAt = text(match.matchDateTimeUTC);
    const start = Date.parse(startsAt);
    const home = object(match.team1);
    const away = object(match.team2);
    if (!id || !Number.isFinite(start) || !text(home.teamName) || !text(away.teamName)) return [];
    const finished = match.matchIsFinished === true;
    const live = !finished && start <= now && now < start + 3 * 60 * 60_000;
    const status: LiveEvent['status'] = finished ? 'final' : live ? 'live' : 'scheduled';
    const results = Array.isArray(match.matchResults) ? match.matchResults.map(object) : [];
    const final = results.find((result) => result.resultTypeID === 2) ?? results.at(-1);
    const goals = Array.isArray(match.goals) ? object(match.goals.at(-1)) : {};
    const homeScore = scoreOf(final?.pointsTeam1 ?? goals.scoreTeam1, status === 'scheduled');
    const awayScore = scoreOf(final?.pointsTeam2 ?? goals.scoreTeam2, status === 'scheduled');
    return [{
      id,
      league,
      sport: 'soccer',
      leagueName,
      name: `${text(away.teamName)} at ${text(home.teamName)}`,
      startsAt: new Date(start).toISOString(),
      status,
      statusText: finished ? 'Final' : live ? 'In progress' : 'Scheduled',
      clock: null,
      period: null,
      home: { id: `${id}-home`, name: text(home.teamName), shortName: text(home.shortName) || text(home.teamName), score: homeScore, ...(safeHttps(home.teamIconUrl) ? {logo: safeHttps(home.teamIconUrl)} : {}) },
      away: { id: `${id}-away`, name: text(away.teamName), shortName: text(away.shortName) || text(away.teamName), score: awayScore, ...(safeHttps(away.teamIconUrl) ? {logo: safeHttps(away.teamIconUrl)} : {}) },
      ...(text(object(match.location).locationStadium) ? {venue: text(object(match.location).locationStadium)} : {}),
      scoreSource: 'OpenLigaDB',
      winner: winnerFor(status, awayScore, homeScore),
      completed: completeFor(status),
    } satisfies LiveEvent];
  });
}

/** Normalize the optional TheSportsDB daily feed. It is deliberately strict:
 * incomplete team identity or timestamps are dropped rather than rendered as games. */
export function normalizeSportsDbPayload(
  league: string,
  leagueName: string,
  payload: unknown,
  sport = 'soccer',
): LiveEvent[] {
  const rawEvents: RecordLike[] = Array.isArray(object(payload).events) ? (object(payload).events as unknown[]).map(object) : [];
  return rawEvents.flatMap((raw) => {
    const id = text(raw.idEvent);
    const homeId = text(raw.idHomeTeam);
    const awayId = text(raw.idAwayTeam);
    const homeName = text(raw.strHomeTeam);
    const awayName = text(raw.strAwayTeam);
    const timestamp = text(raw.strTimestamp);
    const normalizedTimestamp = timestamp && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(timestamp) ? `${timestamp}Z` : timestamp;
    const parsed = Date.parse(normalizedTimestamp);
    if (!id || !homeId || !awayId || !homeName || !awayName || !Number.isFinite(parsed)) return [];
    const status = statusOf(text(raw.strStatus));
    const homeScore = scoreOf(raw.intHomeScore, status === 'scheduled');
    const awayScore = scoreOf(raw.intAwayScore, status === 'scheduled');
    const homeLogo = safeHttps(raw.strHomeTeamBadge);
    const awayLogo = safeHttps(raw.strAwayTeamBadge);
    return [{
      id,
      league,
      sport,
      leagueName,
      name: text(raw.strEvent) || `${awayName} at ${homeName}`,
      startsAt: new Date(parsed).toISOString(),
      status,
      statusText: text(raw.strStatus) || (status === 'scheduled' ? 'Scheduled' : status === 'final' ? 'Final' : 'In progress'),
      clock: null,
      period: null,
      home: { id: homeId, name: homeName, shortName: homeName, score: homeScore, ...(homeLogo ? {logo: homeLogo} : {}) },
      away: { id: awayId, name: awayName, shortName: awayName, score: awayScore, ...(awayLogo ? {logo: awayLogo} : {}) },
      ...(text(raw.strVenue) ? {venue: text(raw.strVenue)} : {}),
      scoreSource: 'SportsDB',
      winner: winnerFor(status, awayScore, homeScore),
      completed: completeFor(status),
    } satisfies LiveEvent];
  });
}

const sportsDbAliases: Record<string, string[]> = {
  epl: ['English Premier League', 'Premier League'], efl: ['English Championship', 'Championship'], facup: ['FA Cup'],
  laliga: ['Spanish La Liga', 'La Liga'], mls: ['Major League Soccer', 'MLS'], ucl: ['UEFA Champions League', 'Champions League'],
  bundesliga: ['German Bundesliga', 'Bundesliga'], bl2: ['2. Bundesliga', 'Bundesliga 2'], bl3: ['3. Liga'],
  dfb_pokal: ['DFB-Pokal', 'DFB Pokal'], seriea: ['Italian Serie A', 'Serie A'], ligue1: ['French Ligue 1', 'Ligue 1'],
  ligue2: ['French Ligue 2', 'Ligue 2'], ligamx: ['Mexican Liga MX', 'Liga MX'], argentina: ['Argentine Primera División', 'Primera Division'],
  brasileirao: ['Brazilian Série A', 'Brazilian Serie A', 'Brasileirão Série A'], aleague: ['Australian A-League', 'A-League'],
  nationsleague: ['UEFA Nations League', 'Nations League'], nwsl: ["National Women's Soccer League", 'NWSL'],
  wsl: ["English Women's Super League", "Women's Super League"], concacafnl: ['CONCACAF Nations League'],
  nfl: ['NFL'], nba: ['NBA'], wnba: ['WNBA'], ncaab: ["NCAA Men's Basketball"], ncaaw: ["NCAA Women's Basketball"],
  mlb: ['MLB'], nhl: ['NHL'], atp: ['ATP'], wta: ['WTA'], premrugby: ['Premiership Rugby'], top14: ['Top 14'],
};

function normalizeName(value: string): string {
  return value.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function sportsDbLeagueMatches(league: string, name: unknown): boolean {
  const normalized = normalizeName(text(name));
  if (!normalized) return false;
  return (sportsDbAliases[league] ?? []).some(candidate => {
    const alias = normalizeName(candidate);
    return normalized === alias || normalized.includes(alias) || alias.includes(normalized);
  });
}

const aliases: Record<string, { competitions: string[]; countries?: string[] }> = {
  epl: {competitions: ['Premier League'], countries: ['England']},
  efl: {competitions: ['Championship'], countries: ['England']},
  facup: {competitions: ['FA Cup'], countries: ['England']},
  laliga: {competitions: ['LaLiga', 'La Liga', 'Primera Division', 'Primera División'], countries: ['Spain']},
  mls: {competitions: ['MLS', 'Major League Soccer'], countries: ['USA', 'United States']},
  ucl: {competitions: ['UEFA Champions League', 'Champions League']},
  bundesliga: {competitions: ['Bundesliga'], countries: ['Germany']},
  bl2: {competitions: ['2. Bundesliga', 'Bundesliga 2'], countries: ['Germany']},
  bl3: {competitions: ['3. Liga'], countries: ['Germany']},
  dfb_pokal: {competitions: ['DFB-Pokal', 'DFB Pokal'], countries: ['Germany']},
  seriea: {competitions: ['Serie A'], countries: ['Italy']},
  ligue1: {competitions: ['Ligue 1'], countries: ['France']},
  ligue2: {competitions: ['Ligue 2'], countries: ['France']},
  ligamx: {competitions: ['Liga MX'], countries: ['Mexico']},
  argentina: {competitions: ['Primera Division', 'Primera División', 'Liga Profesional'], countries: ['Argentina']},
  brasileirao: {competitions: ['Serie A', 'Brasileirão'], countries: ['Brazil']},
  aleague: {competitions: ['A-League', 'A League'], countries: ['Australia']},
  nationsleague: {competitions: ['Nations League', 'UEFA Nations League']},
  nwsl: {competitions: ['NWSL', "National Women's Soccer League"], countries: ['USA', 'United States']},
  wsl: {competitions: ["Women's Super League"], countries: ['England']},
  concacafnl: {competitions: ['CONCACAF Nations League', 'Nations League']},
  afconqual: {competitions: ['Africa Cup of Nations', 'AFCON']},
};

export function liveScoreStageMatches(league: string, stage: RecordLike): boolean {
  const alias = aliases[league];
  if (!alias) return false;
  const competition = normalizeName(text(stage.CompN || stage.Snm || stage.Cnm).split(':')[0]);
  if (!alias.competitions.some((candidate) => normalizeName(candidate) === competition)) return false;
  if (!alias.countries?.length) return true;
  const country = normalizeName(text(stage.Cnm || stage.Ccd));
  return alias.countries.some((candidate) => normalizeName(candidate) === country);
}
