import { LIVE_LEAGUES } from './sports-leagues';
import { supportsDrawPick } from './pick-outcomes';
import { LIVE_SCORE_REFRESH_MS, SCHEDULE_REFRESH_MS, SCORE_RETRY_MS } from './score-refresh';
import { applyNhlScores, nhlScoreDate } from './nhl-score-fallback';

export { LIVE_LEAGUES } from './sports-leagues';

type LiveTeam = {
  id: string;
  name: string;
  shortName: string;
  score: number | null;
  logo?: string;
  linescores?: (number | null)[];
  tennisSetDetails?: {tiebreak: number | null; winner: boolean | null}[];
};

type FightCard = {
  cardId: string;
  cardName: string;
  order: number;
  weightClass?: string;
  rounds?: number;
  location?: string;
  records: {away?: string; home?: string};
  scorecards?: {away: number[]; home: number[]};
};

type TeamStat = { key: string; label: string; away: string | null; home: string | null };
type PlayerStatGroup = {
  name: string;
  columns: string[];
  players: { id: string; name: string; values: string[] }[];
};
type Leader = {id: string; name: string; value: string; headshot?: string};
type GameLeaderCategory = {key: string; label: string; away: Leader[]; home: Leader[]};

type ScoringPlay = {
  id: string;
  description: string;
  side: 'away' | 'home' | null;
  period: number | null;
  clock: string | null;
  awayScore: number | null;
  homeScore: number | null;
};

type RecentResult = {
  id: string;
  date: string;
  opponent: string;
  away: boolean;
  result: 'W' | 'L' | 'T' | 'D';
  score: string | null;
};

type TeamInjury = {
  id: string;
  name: string;
  position: string;
  status: string;
  injury: string;
  reportedAt: string | null;
};

type MatchupSide = { record: string; recent: RecentResult[]; injuries: TeamInjury[] };
type SeriesGame = {
  id: string; date: string; awayName: string; homeName: string;
  state: 'scheduled' | 'live' | 'final'; score: string | null;
};
type SoccerLineupPlayer = {id:string; name:string; jersey:string; position:string; subbedIn:boolean};
type SoccerLineup = {formation:string; starters:SoccerLineupPlayer[]; bench:SoccerLineupPlayer[]};
type SoccerStanding = {
  teamId: string; name: string; rank: number; played: number | null;
  goalDifference: number | null; points: number | null;
};

type NbaStanding = {
  teamId: string;
  name: string;
  wins: number | null;
  losses: number | null;
  winPercent: number | null;
  gamesBehind: number | null;
};

type FootballPosition = {
  possession: 'away' | 'home';
  fieldPercent: number;
  spot: string;
  downAndDistance: string;
};

type FootballDrive = {
  id: string;
  side: 'away' | 'home';
  result: string | null;
  scoring: boolean;
  plays: number | null;
  yards: number | null;
  duration: string | null;
  from: string | null;
  to: string | null;
  period: number | null;
  clock: string | null;
};

export type LiveEvent = {
  id: string;
  league: string;
  sport: string;
  leagueName: string;
  name: string;
  startsAt: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled' | 'unknown';
  statusText: string;
  clock: string | null;
  period: number | null;
  home: LiveTeam;
  away: LiveTeam;
  venue?: string;
  footballPosition?: FootballPosition;
  footballDrives?: FootballDrive[];
  teamStats?: TeamStat[];
  playerStats?: { away: PlayerStatGroup[]; home: PlayerStatGroup[] };
  leaders?: GameLeaderCategory[];
  pregameLeaders?: GameLeaderCategory[];
  scoringPlays?: ScoringPlay[];
  timeline?: ScoringPlay[];
  soccerCommentary?: {sequence:number; clock:string | null; description:string}[];
  shootoutScores?: {away:number;home:number};
  soccerAggregate?: {away:number;home:number;leg:number;totalLegs:number;advances:'away'|'home'|null};
  matchup?: { away: MatchupSide; home: MatchupSide; series: string; seriesGames?: SeriesGame[] };
  soccerLineups?: Partial<Record<'away'|'home',SoccerLineup>>;
  soccerStandings?: {title:string; rows:SoccerStanding[]}[];
  nbaStandings?: {title:string; rows:NbaStanding[]}[];
  fight?: FightCard;
  providerUrl?: string;
  scoreSource?: 'NHL';
  winner: 'home' | 'away' | 'draw' | null;
  completed: boolean;
};

export type LiveBoard = {
  events: LiveEvent[];
  golf?: GolfTournament[];
  leagues: { id: string; sport: string; name: string; status: 'ok' | 'stale' | 'error'; lastSuccessAt?: string; scoresUpdatedAt?: string; error?: string }[];
  fetchedAt: string;
  source: 'ESPN';
  refreshAfterMs: number;
  stale: boolean;
};

type Json = Record<string, any>;
const object = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const score = (v: unknown): number | null => {
  const value = typeof v === 'object' ? object(v).displayValue : v;
  return (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) && Number.isFinite(Number(value)) ? Number(value) : null;
};

function normalizeSoccerAggregate(competition: Json, awayId: string, homeId: string): LiveEvent['soccerAggregate'] {
  const series = Array.isArray(competition.series) ? competition.series : [];
  for (const raw of series) {
    const {leg,totalCompetitions,completed,competitors} = object(raw);
    if (!Number.isSafeInteger(leg) || !Number.isSafeInteger(totalCompetitions) ||
        totalCompetitions < 2 || leg < 1 || leg > totalCompetitions ||
        !Array.isArray(competitors) || competitors.length !== 2) continue;
    const sides = competitors.map(object);
    const away = sides.find(side=>side.id===awayId);
    const home = sides.find(side=>side.id===homeId);
    if (!away || !home) continue;
    const awayScore = score(away.aggregateScore);
    const homeScore = score(home.aggregateScore);
    if (awayScore === null || homeScore === null || !Number.isSafeInteger(awayScore) ||
        !Number.isSafeInteger(homeScore) || awayScore < 0 || homeScore < 0) continue;
    let advances: 'away'|'home'|null = null;
    if (completed === true && leg === totalCompetitions) {
      if (away.winner === true && home.winner === false) advances = 'away';
      if (home.winner === true && away.winner === false) advances = 'home';
    }
    return {away:awayScore,home:homeScore,leg,totalLegs:totalCompetitions,advances};
  }
}

export class LiveSportsError extends Error {
  constructor(message: string, public readonly status = 502, public readonly board?: LiveBoard) {
    super(message);
    this.name = 'LiveSportsError';
  }
}

function leagueConfig(league: string) {
  const config = LIVE_LEAGUES.find(item => item.id === league);
  if (!config) throw new LiveSportsError('Unsupported league key', 400);
  return config;
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(value);

function safeUrl(value: unknown, asset = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const hosts = asset ? ['a.espncdn.com', 'a1.espncdn.com', 'a2.espncdn.com', 'a3.espncdn.com', 'a4.espncdn.com'] : ['www.espn.com', 'espn.com'];
    if (url.protocol === 'https:' && hosts.includes(url.hostname) && !url.port && !url.username && !url.password) return url.href;
  } catch { /* Untrusted provider links are omitted, never followed. */ }
  return undefined;
}

function invalid(message: string): never { throw new LiveSportsError(`Invalid ESPN scoreboard: ${message}`); }

const baseballMetrics = new Map([
  ['batting', new Set(['runs', 'hits', 'doubles', 'triples', 'homeRuns', 'RBIs', 'walks', 'strikeouts', 'stolenBases', 'runnersLeftOnBase'])],
  ['pitching', new Set(['innings', 'hits', 'runs', 'earnedRuns', 'homeRuns', 'walks', 'strikeouts', 'pitchCount', 'strikes'])],
  ['fielding', new Set(['errors', 'doublePlays', 'assists', 'putouts'])],
]);

function comparisonStats(raw: unknown, sport: string) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).flatMap((item: unknown) => {
    const group = object(item);
    if (!Array.isArray(group.stats)) return [{stat: group, category: '', prefix: ''}];
    const category = text(group.name);
    const prefix = text(group.displayName || group.name);
    const baseball = baseballMetrics.get(category);
    return group.stats.slice(0, 100).map(object)
      .filter((stat: Json) => sport !== 'baseball' || baseball?.has(text(stat.name)))
      .map((stat: Json) => ({stat, category, prefix}));
  });
}

function normalizeBoxScore(data: Json, event: LiveEvent) {
  const box = object(data.boxscore);
  const teams: Json[] = Array.isArray(box.teams) ? box.teams.map(object) : [];
  const stats = new Map<string, TeamStat>();
  for (const side of ['away', 'home'] as const) {
    const row = teams.find(team => object(team.team).id === event[side].id);
    for (const {stat, category, prefix} of comparisonStats(row?.statistics, event.sport).slice(0, 60)) {
      const name = text(stat.name).trim();
      const label = text(stat.label || stat.displayName || stat.name).trim();
      const display = text(stat.displayValue).trim();
      if (!name || !label || !display) continue;
      const key = category ? `${category}:${name}` : name;
      const description = prefix ? `${prefix} · ${label}` : label;
      const entry = stats.get(key) ?? { key, label: description.slice(0, 80), away: null, home: null };
      entry[side] = display.slice(0, 32);
      stats.set(key, entry);
    }
  }
  return [...stats.values()];
}

function normalizePlayerStats(data: Json, event: LiveEvent): LiveEvent['playerStats'] {
  const box = object(data.boxscore);
  const teams: Json[] = Array.isArray(box.players) ? box.players.map(object) : [];
  function forTeam(id: string): PlayerStatGroup[] {
    const groups = teams.find(team => object(team.team).id === id)?.statistics;
    if (!Array.isArray(groups)) return [];
    return groups.slice(0, 20).flatMap((raw: unknown) => {
      const group = object(raw);
      if (!Array.isArray(group.labels) || !group.labels.length || !Array.isArray(group.athletes)) return [];
      const columns = group.labels.slice(0, 24).map((value: unknown) => text(value).trim().slice(0, 16));
      if (columns.some((label: string) => !label)) return [];
      const players = new Map<string, PlayerStatGroup['players'][number]>();
      for (const rawRow of group.athletes.slice(0, 80)) {
        const row = object(rawRow);
        const athlete = object(row.athlete);
        const name = text(athlete.displayName || athlete.fullName).trim();
        if (!validId(athlete.id) || !name || row.didNotPlay === true || !Array.isArray(row.stats) ||
            row.stats.length !== group.labels.length) continue;
        const values = row.stats.slice(0, columns.length).map((value: unknown) =>
          (typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value).trim()).slice(0, 24));
        if (values.some(Boolean)) players.set(athlete.id, {id: athlete.id, name: name.slice(0, 100), values});
      }
      return players.size ? [{
        name: (text(group.text || group.name || group.type).trim() || 'Box score').slice(0, 48),
        columns, players: [...players.values()],
      }] : [];
    });
  }
  const away = forTeam(event.away.id);
  const home = forTeam(event.home.id);
  return away.length || home.length ? {away, home} : undefined;
}

function normalizeGameLeaders(data: Json, event: LiveEvent): GameLeaderCategory[] {
  if (!Array.isArray(data.leaders)) return [];
  const categories = new Map<string, GameLeaderCategory>();
  for (const raw of data.leaders.slice(0, 8)) {
    const team = object(raw);
    const id = object(team.team).id;
    const side = id === event.away.id ? 'away' : id === event.home.id ? 'home' : null;
    if (!side || !Array.isArray(team.leaders)) continue;

    for (const item of team.leaders.slice(0, 20)) {
      const group = object(item);
      const key = text(group.name).trim().slice(0, 80);
      const label = text(group.displayName || group.shortDisplayName).trim().slice(0, 80);
      if (!key || !label || !Array.isArray(group.leaders)) continue;
      const players = new Map<string, Leader>();
      for (const value of group.leaders.slice(0, 8)) {
        const leader = object(value);
        const athlete = object(leader.athlete);
        const name = text(athlete.displayName || athlete.fullName).trim().slice(0, 100);
        const display = text(leader.displayValue).trim().slice(0, 100);
        const teamId = object(athlete.team).id;
        if (!validId(athlete.id) || !name || !display || (validId(teamId) && teamId !== id)) continue;
        const headshot = safeUrl(object(athlete.headshot).href,true);
        if (!players.has(athlete.id)) players.set(athlete.id,{id:athlete.id,name,value:display,...(headshot?{headshot}:{})});
      }
      if (!players.size) continue;
      const category = categories.get(key) ?? {key,label,away:[],home:[]};
      if (!category[side].length) category[side] = [...players.values()].slice(0,3);
      categories.set(key,category);
    }
  }
  return [...categories.values()];
}

function normalizeScoringPlays(data: Json, event: LiveEvent): ScoringPlay[] {
  const providerScoring = Array.isArray(data.scoringPlays) ? data.scoringPlays : [];
  const plays = event.sport === 'soccer' && Array.isArray(data.keyEvents) ? data.keyEvents : data.plays;
  const source = providerScoring.length ? providerScoring
    : Array.isArray(plays) ? plays.slice(-2000).filter((play: unknown) => object(play).scoringPlay === true)
      : [];
  return normalizePlays(source.slice(-200), event).slice(0, 30);
}

function normalizePlays(source: unknown[], event: LiveEvent): ScoringPlay[] {
  const plays = new Map<string, ScoringPlay>();
  for (const raw of source) {
    const play = object(raw);
    const description = text(play.text || play.shortText).trim();
    if (typeof play.id !== 'string' || !/^[0-9]{1,32}$/.test(play.id) || !description) continue;
    const team = object(play.team).id;
    const period = object(play.period).number;
    plays.set(play.id, {
      id: play.id,
      description: description.slice(0, 240),
      side: team === event.away.id ? 'away' : team === event.home.id ? 'home' : null,
      period: Number.isInteger(period) && period > 0 ? period : null,
      clock: text(object(play.clock).displayValue).trim().slice(0, 20) || null,
      awayScore: score(play.awayScore),
      homeScore: score(play.homeScore),
    });
  }
  return [...plays.values()].reverse();
}

function normalizeTimeline(data: Json, event: LiveEvent): ScoringPlay[] {
  if (Array.isArray(data.plays) && data.plays.length) return normalizePlays(data.plays.slice(-500), event);
  if (event.sport === 'soccer' && Array.isArray(data.keyEvents)) {
    return normalizePlays(data.keyEvents.slice(-500), event);
  }
  const drives = object(data.drives);
  const previous = Array.isArray(drives.previous) ? drives.previous.slice(-100) : [];
  const source = [...previous, drives.current].flatMap(raw => {
    const plays = object(raw).plays;
    return Array.isArray(plays) ? plays.slice(-100) : [];
  });
  return normalizePlays(source.slice(-500), event);
}

function normalizeSoccerCommentary(data: Json): NonNullable<LiveEvent['soccerCommentary']> {
  if (!Array.isArray(data.commentary)) return [];
  const entries = new Map<number, NonNullable<LiveEvent['soccerCommentary']>[number]>();
  for (const item of data.commentary.slice(-500)) {
    const row = object(item);
    const description = text(row.text).trim();
    if (!Number.isSafeInteger(row.sequence) || row.sequence < 0 || !description) continue;
    entries.set(row.sequence, {
      sequence: row.sequence,
      clock: text(object(row.time).displayValue).trim().slice(0, 20) || null,
      description: description.slice(0, 500),
    });
  }
  return [...entries.values()].sort((a,b)=>b.sequence-a.sequence);
}

function normalizeSoccerStandings(data: Json, event: LiveEvent): NonNullable<LiveEvent['soccerStandings']> {
  const standings = object(data.standings);
  if (!Array.isArray(standings.groups)) return [];
  return standings.groups.slice(0,12).flatMap((raw: unknown) => {
    const group = object(raw);
    const entries = object(group.standings).entries;
    if (!Array.isArray(entries)) return [];
    const rows = new Map<string,SoccerStanding>();
    for (const rawEntry of entries.slice(0,80)) {
      const entry = object(rawEntry);
      const name = text(entry.team).trim();
      if (!validId(entry.id) || !name || !Array.isArray(entry.stats) || rows.has(entry.id)) continue;
      const stats = new Map<string,number>();
      for (const rawStat of entry.stats) {
        const stat = object(rawStat);
        if (Number.isSafeInteger(stat.value)) stats.set(text(stat.name),stat.value);
      }
      const rank = stats.get('rank');
      if (!rank || rank < 1) continue;
      const played = stats.get('gamesPlayed');
      rows.set(entry.id, {teamId:entry.id,name:name.slice(0,100),rank,
        played:played !== undefined && played >= 0 ? played : null,
        goalDifference:stats.get('pointDifferential') ?? null,
        points:stats.get('points') ?? null,
      });
    }
    if (!rows.has(event.away.id) && !rows.has(event.home.id)) return [];
    const title = text(group.header || standings.header).trim().slice(0,120) || `${event.leagueName} standings`;
    return [{title,rows:[...rows.values()].sort((a,b)=>a.rank-b.rank)}];
  });
}

function normalizeNbaStandings(data: Json, event: LiveEvent): NonNullable<LiveEvent['nbaStandings']> {
  const standings = object(data.standings);
  if (!Array.isArray(standings.groups)) return [];
  return standings.groups.slice(0,6).flatMap((raw:unknown)=>{
    const group = object(raw);
    const entries = object(group.standings).entries;
    if (!Array.isArray(entries)) return [];
    const rows = new Map<string,NbaStanding>();
    for (const rawEntry of entries.slice(0,30)) {
      const entry = object(rawEntry);
      const name = text(entry.team).trim();
      if (!validId(entry.id) || !name || !Array.isArray(entry.stats) || rows.has(entry.id)) continue;
      const stats = new Map<string,number>();
      for (const rawStat of entry.stats) {
        const {name,value} = object(rawStat);
        if (typeof value === 'number' && Number.isFinite(value)) stats.set(text(name),value);
      }
      const winPercent = stats.get('winPercent');
      const wins = stats.get('wins');
      const losses = stats.get('losses');
      rows.set(entry.id,{
        teamId:entry.id, name:name.slice(0,100),
        wins:wins!==undefined && Number.isSafeInteger(wins) && wins>=0 ? wins : null,
        losses:losses!==undefined && Number.isSafeInteger(losses) && losses>=0 ? losses : null,
        winPercent:winPercent!==undefined && winPercent>=0 && winPercent<=1 ? winPercent : null,
        gamesBehind:stats.get('gamesBehind')??null,
      });
    }
    if (!rows.has(event.away.id) && !rows.has(event.home.id)) return [];
    const title = text(group.header || standings.header).trim().slice(0,120) || 'NBA standings';
    return [{title,rows:[...rows.values()]}];
  });
}

function normalizeSoccerLineups(data: Json, event: LiveEvent): LiveEvent['soccerLineups'] {
  if (event.sport !== 'soccer' || !Array.isArray(data.rosters)) return undefined;
  const teams = data.rosters.map(object);
  const lineups: NonNullable<LiveEvent['soccerLineups']> = {};
  for (const side of ['away','home'] as const) {
    const team = teams.find(row=>object(row.team).id===event[side].id);
    if (!team || !Array.isArray(team.roster)) continue;
    const starters: SoccerLineupPlayer[] = [];
    const bench: SoccerLineupPlayer[] = [];
    const seen = new Set<string>();
    for (const raw of team.roster.slice(0,40)) {
      const row = object(raw);
      const athlete = object(row.athlete);
      const name = text(athlete.displayName || athlete.fullName).trim().slice(0,120);
      if (!validId(athlete.id) || !name || typeof row.starter !== 'boolean' || seen.has(athlete.id)) continue;
      seen.add(athlete.id);
      const jersey = typeof row.jersey === 'number' ? String(row.jersey) : text(row.jersey);
      const position = object(row.position);
      const player = {id:athlete.id,name,jersey:/^\d{1,3}$/.test(jersey) ? jersey : '',
        position:text(position.displayName || position.name).trim().slice(0,70),subbedIn:row.subbedIn===true};
      (row.starter ? starters : bench).push(player);
    }
    if (!starters.length) continue;
    const formation = text(team.formation).trim();
    const validFormation = /^[1-9](?:-[1-9]){1,4}$/.test(formation) &&
      formation.split('-').reduce((total,value)=>total+Number(value),0)===10;
    lineups[side] = {formation:validFormation ? formation : '', starters, bench};
  }
  return lineups.home || lineups.away ? lineups : undefined;
}

function normalizeMatchup(data: Json, event: LiveEvent): LiveEvent['matchup'] {
  const competitions = object(data.header).competitions;
  const competition = Array.isArray(competitions) ? competitions.map(object).find(row => row.id === event.id) : undefined;
  const competitors: Json[] = Array.isArray(competition?.competitors) ? competition.competitors.map(object) : [];
  const recentGroups: Json[] = Array.isArray(data.lastFiveGames) ? data.lastFiveGames.map(object) : [];
  const injuryGroups: Json[] = Array.isArray(data.injuries) ? data.injuries.map(object) : [];

  function forTeam(id: string): MatchupSide {
    const records = competitors.find(row => row.id === id)?.record;
    const total = Array.isArray(records) ? records.map(object).find(row => row.type === 'total') : undefined;
    const record = text(total?.displayValue || total?.summary).trim().slice(0, 48);
    const games = recentGroups.find(row => object(row.team).id === id)?.events;
    const reports = injuryGroups.find(row => object(row.team).id === id)?.injuries;
    const recent = new Map<string, RecentResult>();
    const injuries = new Map<string, TeamInjury>();

    if (Array.isArray(games)) {
      for (const raw of games.slice(0, 20)) {
        const game = object(raw);
        const date = Date.parse(text(game.gameDate));
        const opponent = text(object(game.opponent).displayName).trim();
        const result = game.gameResult;
        const away = game.awayTeamId === id;
        if (!validId(game.id) || !Number.isFinite(date) || date >= Date.parse(event.startsAt) ||
            !opponent || !['W', 'L', 'T', 'D'].includes(result) || (!away && game.homeTeamId !== id)) continue;
        const mine = score(away ? game.awayTeamScore : game.homeTeamScore);
        const theirs = score(away ? game.homeTeamScore : game.awayTeamScore);
        recent.set(game.id, {
          id: game.id, date: new Date(date).toISOString(), opponent: opponent.slice(0, 120), away, result,
          score: mine !== null && theirs !== null ? `${mine}–${theirs}` : null,
        });
      }
    }

    if ((event.status === 'scheduled' || event.status === 'live') && Array.isArray(reports)) {
      for (const raw of reports.slice(0, 50)) {
        const report = object(raw);
        const athlete = object(report.athlete);
        const name = text(athlete.displayName).trim();
        const status = text(report.status).trim();
        if (!validId(athlete.id) || !name || !status) continue;
        const date = Date.parse(text(report.date));
        const reportedAt = Number.isFinite(date) ? new Date(date).toISOString() : null;
        const previous = injuries.get(athlete.id);
        if (previous?.reportedAt && (!reportedAt || previous.reportedAt >= reportedAt)) continue;
        injuries.set(athlete.id, {
          id: athlete.id, name: name.slice(0, 90), status: status.slice(0, 48), reportedAt,
          position: text(object(athlete.position).abbreviation).trim().slice(0, 16),
          injury: text(object(report.details).type).trim().slice(0, 80),
        });
      }
    }

    return {
      record,
      recent: [...recent.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      injuries: [...injuries.values()].sort((a, b) => (b.reportedAt ?? '').localeCompare(a.reportedAt ?? '')),
    };
  }

  const away = forTeam(event.away.id);
  const home = forTeam(event.home.id);
  const sourceSeries = Array.isArray(data.seasonseries) ? data.seasonseries.map(object) : [];
  const series = (sourceSeries.map((entry: Json) => text(entry.summary).trim()).find(Boolean) ?? '').slice(0, 120);
  const seriesGames = new Map<string, SeriesGame>();
  for (const group of sourceSeries.slice(0, 8)) {
    if (!Array.isArray(group.events)) continue;
    for (const raw of group.events.slice(0, 24)) {
      const game = object(raw);
      const startsAt = Date.parse(text(game.date));
      const status = object(game.statusType);
      const state = status.state === 'pre' ? 'scheduled' : status.state === 'in' ? 'live'
        : status.state === 'post' && status.completed === true && /^STATUS_FINAL/.test(text(status.name)) ? 'final' : null;
      if (!validId(game.id) || !Number.isFinite(startsAt) || !state || !Array.isArray(game.competitors)) continue;
      if (game.competitors.length !== 2) continue;
      const teams = game.competitors.map(object);
      const visitor = teams.find((team: Json)=>team.homeAway === 'away');
      const host = teams.find((team: Json)=>team.homeAway === 'home');
      if (!visitor || !host) continue;
      const visitorId = object(visitor.team).id;
      const hostId = object(host.team).id;
      if (!(visitorId === event.away.id && hostId === event.home.id) &&
          !(visitorId === event.home.id && hostId === event.away.id)) continue;
      const awayName = visitorId === event.away.id ? event.away.shortName : event.home.shortName;
      const homeName = hostId === event.home.id ? event.home.shortName : event.away.shortName;
      const awayScore = score(visitor.score);
      const homeScore = score(host.score);
      const publishedScore = state !== 'scheduled' && awayScore !== null && homeScore !== null ? `${awayScore}–${homeScore}` : null;
      if (!seriesGames.has(game.id)) seriesGames.set(game.id, {
        id:game.id,date:new Date(startsAt).toISOString(),awayName,homeName,state,score:publishedScore,
      });
    }
  }
  if (!series && !seriesGames.size && ![away, home].some(side => side.record || side.recent.length || side.injuries.length)) return undefined;
  return {away, home, series, ...(seriesGames.size ? {seriesGames:[...seriesGames.values()].sort((a,b)=>a.date.localeCompare(b.date))} : {})};
}

function normalizeFightCard(event: Json, bout: Json, order: number, away: Json, home: Json) {
  const venue = object(bout.venue ?? (Array.isArray(event.venues) ? event.venues[0] : undefined));
  const address = object(venue.address);
  const location = [address.city,address.country].map(part=>text(part).trim()).filter(Boolean).join(', ').slice(0,120);
  const name = text(event.name).trim().slice(0,160);
  const weightClass = text(object(bout.type).abbreviation).trim().slice(0,60);
  const rounds = object(object(bout.format).regulation).periods;
  const record = (athlete: Json) => {
    const records = Array.isArray(athlete.records) ? athlete.records.map(object) : [];
    const summary = text(records.find(entry=>entry.type==='total')?.summary).trim();
    return /^\d{1,3}-\d{1,3}-\d{1,3}$/.test(summary) ? summary : undefined;
  };
  const judgeScores = (athlete: Json): number[] => {
    if (!Array.isArray(athlete.linescores) || athlete.linescores.length !== 1) return [];
    const aggregate = object(athlete.linescores[0]);
    if (aggregate.period !== 0 || !Array.isArray(aggregate.linescores) || aggregate.linescores.length !== 3) return [];
    const scores = aggregate.linescores.map(entry=>score(object(entry).value));
    return scores.every((value): value is number => value !== null && Number.isInteger(value) && value >= 0) ? scores : [];
  };
  const awayScores = judgeScores(away);
  const homeScores = judgeScores(home);
  const fight: FightCard = {
    cardId: event.id, cardName: name || 'UFC', order,
    ...(weightClass ? {weightClass} : {}),
    ...(Number.isInteger(rounds) && rounds > 0 && rounds <= 5 ? {rounds} : {}),
    ...(location ? {location} : {}),
    records: {away:record(away),home:record(home)},
    ...(awayScores.length && homeScores.length ? {scorecards:{away:awayScores,home:homeScores}} : {}),
  };
  return {fight,venue:text(venue.fullName).trim().slice(0,160) || undefined};
}

function normalizeFootballPosition(
  source: unknown, possessionId: unknown, away: LiveTeam, home: LiveTeam,
): FootballPosition | undefined {
  const data = object(source);
  const possession = possessionId === away.id ? 'away' : possessionId === home.id ? 'home' : null;
  const downAndDistance = text(data.shortDownDistanceText).trim();
  const spot = text(data.possessionText).trim();
  if (!possession || !/^(?:1st|2nd|3rd|4th) & (?:[1-9][0-9]?|Goal|Inches)$/i.test(downAndDistance)) return;

  const territory = /^([A-Z0-9]{2,5}) ([0-9]{1,2})$/i.exec(spot);
  if (spot === '50') return {possession, fieldPercent:50, spot, downAndDistance};
  if (!territory) return;
  const [, team, yards] = territory;
  const yard = Number(yards);
  if (yard < 1 || yard > 50) return;
  if (team === away.shortName) return {possession, fieldPercent:yard, spot, downAndDistance};
  if (team === home.shortName) return {possession, fieldPercent:100 - yard, spot, downAndDistance};
}

function normalizeDrivePosition(data: Json, event: LiveEvent): FootballPosition | undefined {
  const competition = object(object(data.header).competitions?.[0]);
  const status = object(competition.status);
  if (event.sport !== 'football' || event.status !== 'live' || object(status.type).name !== 'STATUS_IN_PROGRESS') return;
  if (event.footballPosition) return event.footballPosition;

  const drive = object(object(data.drives).current);
  const possessionId = object(drive.team).id;
  const play = Array.isArray(drive.plays) ? object(drive.plays.at(-1)) : {};
  const end = object(play.end);
  if (drive.isScore !== false || play.scoringPlay !== false ||
      object(play.period).number !== event.period || object(end.team).id !== possessionId) return;
  return normalizeFootballPosition(end, possessionId, event.away, event.home);
}

function normalizeFootballDrives(data: Json, event: LiveEvent): FootballDrive[] {
  const drives = object(data.drives);
  const history = new Map<string, FootballDrive>();
  const clockText = (value: unknown) => {
    const clock = text(object(value).displayValue);
    return /^[0-9]{1,2}:[0-5][0-9]$/.test(clock) ? clock : null;
  };
  const spotText = (value: unknown) => {
    const spot = text(object(value).text).trim();
    return /^(?:[A-Z0-9]{2,5} (?:[0-4]?[0-9]|50)|50)$/i.test(spot) ? spot : null;
  };
  const normalize = (raw: unknown, active: boolean): FootballDrive | null => {
    const drive = object(raw);
    const team = object(drive.team).id;
    const side = team === event.away.id ? 'away' : team === event.home.id ? 'home' : null;
    const result = text(drive.displayResult).trim().slice(0, 60);
    if (!validId(drive.id) || !side || (active ? Boolean(result || drive.result) : !result)) return null;

    const start = object(drive.start);
    const end = object(drive.end);
    const stamp = active || !end.period ? start : end;
    const period = object(stamp.period).number;
    const plays = score(drive.offensivePlays);
    const yards = score(drive.yards);
    return {
      id:drive.id, side, result:result || null, scoring:!active && drive.isScore === true,
      plays:plays !== null && Number.isInteger(plays) && plays >= 0 && plays <= 100 ? plays : null,
      yards:yards !== null && Number.isInteger(yards) && Math.abs(yards) <= 199 ? yards : null,
      duration:clockText(drive.timeElapsed), from:spotText(start), to:active ? null : spotText(end),
      period:Number.isInteger(period) && period > 0 && period <= 20 ? period : null,
      clock:clockText(stamp.clock),
    };
  };
  const previous = Array.isArray(drives.previous) ? drives.previous.slice(-100) : [];
  for (const raw of previous) {
    const drive = normalize(raw,false);
    if (drive) history.set(drive.id,drive);
  }
  const competition = object(object(data.header).competitions?.[0]);
  const status = object(object(competition.status).type).name;
  const current = event.status === 'live' && status === 'STATUS_IN_PROGRESS' ? normalize(drives.current,true) : null;
  const completed = [...history.values()].reverse();
  return current && !history.has(current.id) ? [current,...completed] : completed;
}

export function normalizeScoreboard(league: string, payload: unknown): LiveEvent[] {
  const config = leagueConfig(league);
  const data = object(payload);
  if (!Array.isArray(data.events)) invalid('events must be an array');
  if (config.sport === 'golf' && data.events.length) throw new LiveSportsError('PGA leaderboard is not a two-sided contest; tournament normalization is unsupported');
  const events: LiveEvent[] = data.events.flatMap((raw: unknown) => {
    const event = object(raw);
    if (!validId(event.id)) invalid('invalid event identifier');
    let competitions: unknown = event.competitions;
    if (config.sport === 'tennis') {
      if (!Array.isArray(event.groupings) || event.groupings.some((g: unknown) => !Array.isArray(object(g).competitions))) invalid('invalid tennis groupings');
      competitions = event.groupings.flatMap((g: Json) => g.competitions);
    }
    if (!Array.isArray(competitions) || (!competitions.length && config.sport !== 'tennis')) invalid('competitions must be a nonempty array');
    const playable = config.sport === 'tennis' ? competitions.filter((rawCompetition: unknown) => {
      const competitors = object(rawCompetition).competitors;
      // ESPN emits future draw slots with negative sentinel IDs, not real athletes.
      // Omit these source placeholders; never fabricate participant identities.
      return !Array.isArray(competitors) || !competitors.some((raw: unknown) => {
        const competitor = object(raw);
        const participant = object(competitor.athlete ?? competitor.roster);
        return /^-[0-9]+$/.test(text(competitor.id)) && participant.displayName === 'TBD';
      });
    }) : competitions;
    return playable.map((rawCompetition: unknown, index): LiveEvent => {
      const competition = object(rawCompetition);
      if (!validId(competition.id)) invalid('invalid competition identifier');
      if (!Array.isArray(competition.competitors) || competition.competitors.length !== 2) invalid('expected two real competitors');
      const competitors: Json[] = competition.competitors.map(object).sort((a: Json, b: Json) => (a.order ?? 0) - (b.order ?? 0) || text(a.id).localeCompare(text(b.id)));
      const neutral = config.sport === 'mma';
      const homeRaw = neutral ? competitors[0] : competitors.find(c => c.homeAway === 'home');
      const awayRaw = neutral ? competitors[1] : competitors.find(c => c.homeAway === 'away');
      const side = (competitor: Json | undefined): LiveEvent['home'] => {
        if (!competitor || !validId(competitor.id)) invalid('invalid participant identifier');
        const participant = object(competitor.team ?? competitor.athlete ?? competitor.roster);
        if (!text(participant.displayName).trim()) invalid('missing participant name');
        const logo = safeUrl(participant.logo, true) ?? (Array.isArray(participant.logos)
          ? participant.logos.map((entry: unknown) => safeUrl(object(entry).href, true)).find(Boolean)
          : undefined);
        const rawLines: unknown[] = Array.isArray(competitor.linescores) ? competitor.linescores.slice(0, 30) : [];
        const linescores = rawLines.map(line => score(line) ?? score(object(line).value));
        const tennisSetDetails = config.sport === 'tennis' ? rawLines.map(raw => {
          const line = object(raw);
          const tiebreak = score(line.tiebreak);
          return {
            tiebreak: tiebreak !== null && Number.isInteger(tiebreak) && tiebreak >= 0 ? tiebreak : null,
            winner: typeof line.winner === 'boolean' ? line.winner : null,
          };
        }) : [];
        return {
          id: competitor.id, name: participant.displayName,
          shortName: text(participant.abbreviation || participant.shortName || participant.shortDisplayName || participant.displayName),
          score: score(competitor.score), ...(logo ? { logo } : {}),
          ...(!neutral && linescores.some(value => value !== null) ? { linescores } : {}),
          ...(tennisSetDetails.some(line => line.tiebreak !== null || line.winner !== null) ? {tennisSetDetails} : {}),
        };
      };
      const home = side(homeRaw);
      const away = side(awayRaw);
      if (home.id === away.id) invalid('duplicate participant');
      const status = object(competition.status ?? event.status);
      const type = object(status.type);
      if (!text(type.name) || !['pre', 'in', 'post'].includes(type.state) || typeof type.completed !== 'boolean') invalid('invalid contest status');
      const code = text(type.name);
      const afterPenalties = config.sport === 'soccer' && code === 'STATUS_FINAL_PEN';
      const finalCode = ['STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_FINAL_SO', 'STATUS_FULL_TIME'].includes(code) || afterPenalties ||
        (config.sport === 'soccer' && code === 'STATUS_FINAL_AET');
      const completed = type.completed === true && type.state === 'post' && finalCode;
      const normalizedStatus: LiveEvent['status'] = /CANCEL|ABANDON/.test(code) ? 'cancelled'
        : /POSTPON/.test(code) ? 'postponed'
        : completed ? 'final'
        : ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT'].includes(code) && type.state === 'in' ? 'live'
        : code === 'STATUS_SCHEDULED' && type.state === 'pre' ? 'scheduled' : 'unknown';
      let winner: LiveEvent['winner'] = null;
      if (completed && homeRaw?.winner === true && awayRaw?.winner === false) winner = 'home';
      if (completed && awayRaw?.winner === true && homeRaw?.winner === false) winner = 'away';
      if (completed && code === 'STATUS_FULL_TIME' && supportsDrawPick(league) &&
          homeRaw?.winner === false && awayRaw?.winner === false &&
          home.score !== null && Number.isInteger(home.score) && home.score >= 0 && home.score === away.score) {
        winner = 'draw';
      }
      const startsAt = competition.date ?? event.date;
      const awayPens = afterPenalties && completed ? score(awayRaw?.shootoutScore) : null;
      const homePens = afterPenalties && completed ? score(homeRaw?.shootoutScore) : null;
      const shootoutScores = awayPens !== null && homePens !== null &&
        Number.isSafeInteger(awayPens) && Number.isSafeInteger(homePens) &&
        awayPens >= 0 && homePens >= 0 ? {away:awayPens,home:homePens} : undefined;
      const soccerAggregate = config.sport === 'soccer' ? normalizeSoccerAggregate(competition, away.id, home.id) : undefined;
      // ESPN's competitor winner flags for two-leg ties can identify the advancing side.
      if (completed && soccerAggregate) {
        winner = null;
        if (away.score !== null && home.score !== null && away.score >= 0 && home.score >= 0 &&
            Number.isSafeInteger(away.score) && Number.isSafeInteger(home.score)) {
          if (away.score !== home.score) winner = away.score > home.score ? 'away' : 'home';
          else if (code === 'STATUS_FULL_TIME' && supportsDrawPick(league)) winner = 'draw';
        }
      }
      if (!text(startsAt) || !Number.isFinite(Date.parse(startsAt))) invalid('invalid contest date');
      const providerUrl = Array.isArray(event.links) ? event.links.map((link: Json) => safeUrl(object(link).href)).find(Boolean) : undefined;
      const situation = object(competition.situation);
      const footballPosition = config.sport === 'football' && code === 'STATUS_IN_PROGRESS' && normalizedStatus === 'live'
        ? normalizeFootballPosition(situation, situation.possession, away, home)
        : undefined;
      return {
        id: competition.id, league, sport: config.sport, leagueName: config.name,
        name: config.sport === 'tennis' || neutral ? `${away.name} vs ${home.name} — ${text(event.name)}` : text(event.name) || `${away.name} at ${home.name}`,
        startsAt: new Date(startsAt).toISOString(), status: normalizedStatus,
        statusText: text(type.detail || type.description || type.shortDetail || code),
        clock: neutral && text(status.displayClock) === '-' ? null : text(status.displayClock) || null,
        period: typeof status.period === 'number' && Number.isInteger(status.period) && status.period >= 0 ? status.period : null,
        home, away, ...(providerUrl ? { providerUrl } : {}), completed, winner,
        ...(shootoutScores ? {shootoutScores} : {}),
        ...(soccerAggregate ? {soccerAggregate} : {}),
        ...(footballPosition ? {footballPosition} : {}),
        ...(neutral && homeRaw && awayRaw ? normalizeFightCard(event,competition,index,awayRaw,homeRaw) : {}),
      };
    });
  });
  const unique = new Map<string, LiveEvent>();
  for (const event of events) {
    const key = `${event.league}:${event.id}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) invalid('conflicting duplicate competition identifier');
    unique.set(key, event);
  }
  return [...unique.values()];
}

export type GolfTournament = {
  id: string; name: string; startsAt: string; statusText: string; completed: boolean;
  state: 'pre' | 'in' | 'post';
  round: number | null; providerUrl?: string;
  leaderboard: { id: string; name: string; score: number | null; displayScore: string | null }[];
};
export type GolfBoard = {
  source: 'ESPN'; league: 'pga'; fetchedAt: string; refreshAfterMs: number;
  stale: boolean; error?: string; events: GolfTournament[];
};

/** Golf is multi-way and deliberately does not use the two-sided LiveEvent contract. */
export function normalizeGolfScoreboard(payload: unknown): GolfTournament[] {
  const data = object(payload);
  if (!Array.isArray(data.events)) invalid('golf events must be an array');
  return data.events.map((raw: unknown) => {
    const event = object(raw);
    if (!validId(event.id) || !text(event.name) || !Array.isArray(event.competitions) || event.competitions.length !== 1) invalid('invalid golf tournament');
    const competition = object(event.competitions[0]);
    const status = object(competition.status ?? event.status);
    const type = object(status.type);
    if (!text(type.name) || !['pre', 'in', 'post'].includes(type.state) || typeof type.completed !== 'boolean') invalid('invalid golf status');
    if (!Array.isArray(competition.competitors)) invalid('golf competitors must be an array');
    const startsAt = competition.date ?? event.date;
    if (!text(startsAt) || !Number.isFinite(Date.parse(startsAt))) invalid('invalid golf date');
    const providerUrl = Array.isArray(event.links) ? event.links.map((link: Json) => safeUrl(object(link).href)).find(Boolean) : undefined;
    return {
      id: event.id, name: event.name, startsAt: new Date(startsAt).toISOString(),
      statusText: text(type.detail || type.description || type.name),
      state: type.state,
      completed: type.completed === true && type.state === 'post' && type.name === 'STATUS_FINAL',
      round: Number.isInteger(status.period) && status.period >= 0 ? status.period : null,
      ...(providerUrl ? { providerUrl } : {}),
      leaderboard: competition.competitors.map((raw: unknown) => {
        const competitor = object(raw);
        const athlete = object(competitor.athlete);
        if (!validId(competitor.id) || !text(athlete.displayName)) invalid('invalid golfer identity');
        return { id: competitor.id, name: athlete.displayName, score: score(competitor.score), displayScore: text(competitor.score) || text(object(competitor.score).displayValue) || null };
      }),
    };
  });
}

const dayMs = 86_400_000;

function scoreboardPath(config: (typeof LIVE_LEAGUES)[number], at: number): string {
  const base = `${config.path}/scoreboard`;
  if (config.id !== 'ufc') return base;
  const date = (offset: number) => new Date(at + offset * dayMs).toISOString().slice(0,10).replaceAll('-','');
  return `${base}?dates=${date(-14)}-${date(42)}`;
}
type ClientOptions = { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; maxResponseBytes?: number };

/** Isolated factory also makes cache/error behavior testable without live network. */
export function createLiveSportsClient(options: ClientOptions = {}) {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  let boardCache: { value: LiveBoard; expires: number } | undefined;
  let refreshing: Promise<LiveBoard> | undefined;
  type LeagueData = { events: LiveEvent[]; golf?: GolfTournament[] };
  const lastGood = new Map<string, LeagueData & { at: number }>();
  type LeagueResult = LeagueData & { league: LiveBoard['leagues'][number] };
  const leagueResults = new Map<string, LeagueResult>();
  const leagueDueAt = new Map<string, number>();
  const retryAfter = new Map<string, number>();
  const espnBackoffUntil = new Map<string, number>();
  const summaryBackoffUntil = new Map<string, number>();
  const leagueLoads = new Map<string, Promise<void>>();
  let nhlBackoffUntil = 0;
  const details = new Map<string, { event: LiveEvent | null; expires: number }>();
  const detailRequests = new Map<string, Promise<LiveEvent | null>>();
  const leagueRequests = new Map<string, Promise<LiveEvent[]>>();

  let activeRequests = 0;
  const requestQueue: (() => void)[] = [];

  async function request(path: string, allowMissing = false): Promise<unknown> {
    return requestJson(`https://site.api.espn.com/apis/site/v2/sports/${path}`, 'ESPN', allowMissing);
  }

  async function requestJson(url: string, provider: 'ESPN' | 'NHL', allowMissing = false): Promise<unknown> {
    if (requestQueue.length >= 64) throw new LiveSportsError('Sports request queue is full; retry shortly', 503);
    if (activeRequests >= 4) await new Promise<void>(resolve => requestQueue.push(resolve));
    else activeRequests++;
    let response: Response | undefined;
    try {
      response = await fetcher(url, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? (allowMissing ? 3_500 : 2_500)),
        headers: { Accept: 'application/json' },
      });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) throw new LiveSportsError(`${provider} HTTP ${response.status}`, response.status === 429 ? 429 : 502);
      if (!response.headers.get('content-type')?.includes('application/json')) throw new LiveSportsError(`${provider} returned non-JSON content`);
      const limit = options.maxResponseBytes ?? 8 * 1024 * 1024;
      const tooLarge = () => new LiveSportsError(`${provider} response exceeds the byte limit`);
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw tooLarge();
      }
      const reader = response.body?.getReader();
      if (!reader) throw new LiveSportsError(`${provider} returned invalid JSON`);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) { await reader.cancel(); throw tooLarge(); }
          chunks.push(chunk.value);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new LiveSportsError(`${provider} returned invalid JSON`); }
      } finally { reader.releaseLock(); }
    } finally {
      // HTTP failures, missing records and HTML walls still own an unread response body.
      if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
      const next = requestQueue.shift();
      if (next) next();
      else activeRequests--;
    }
  }

  async function updateLeague(config: (typeof LIVE_LEAGUES)[number]): Promise<void> {
    const metadata = { id: config.id, name: config.name, sport: config.sport };
    try {
      if ((espnBackoffUntil.get(config.id) ?? 0) > now()) {
        throw new LiveSportsError('ESPN HTTP 429', 429);
      }
      const payload = await request(scoreboardPath(config, now()));
      const data: LeagueData = config.sport === 'golf'
        ? {events: [], golf: normalizeGolfScoreboard(payload)}
        : {events: normalizeScoreboard(config.id, payload)};
      const at = now();
      const live = data.events.some(event => event.status === 'live' ||
        (event.status === 'scheduled' && Math.abs(Date.parse(event.startsAt) - at) <= 60_000)) ||
        data.golf?.some(tournament => tournament.state === 'in');
      leagueDueAt.set(config.id, at + (live ? LIVE_SCORE_REFRESH_MS : SCHEDULE_REFRESH_MS));
      lastGood.set(config.id, {...data, at});
      leagueResults.set(config.id, {
        ...data, league: {...metadata, status: 'ok', lastSuccessAt: new Date(at).toISOString()},
      });
    } catch (error) {
      const rateLimited = error instanceof LiveSportsError && error.status === 429;
      if (rateLimited && (espnBackoffUntil.get(config.id) ?? 0) <= now()) {
        espnBackoffUntil.set(config.id, now() + 30_000);
      }
      const rateLimitEnds = espnBackoffUntil.get(config.id) ?? 0;
      if (rateLimited) retryAfter.set(config.id, rateLimitEnds);
      const message = error instanceof LiveSportsError ? error.message : 'ESPN request failed';
      const previous = lastGood.get(config.id);
      const lastSuccessAt = previous
        ? new Date(previous.at).toISOString()
        : leagueResults.get(config.id)?.league.lastSuccessAt;
      const retained = previous && now() - previous.at <= 300_000;
      let events = retained ? previous.events : [];
      let scoresUpdatedAt: string | undefined;
      let backupRefreshed = false;
      if (config.id === 'nhl' && retained) {
        const candidate = events.find(event => event.status === 'live') ??
          events.find(event => event.status === 'scheduled' && Math.abs(Date.parse(event.startsAt) - now()) <= 60_000);
        if (candidate && now() >= nhlBackoffUntil) {
          try {
            const date = nhlScoreDate(Date.parse(candidate.startsAt));
            const payload = await requestJson(`https://api-web.nhle.com/v1/score/${date}`, 'NHL');
            events = applyNhlScores(events, payload);
            backupRefreshed = events.some(event => event.scoreSource === 'NHL');
            if (backupRefreshed) scoresUpdatedAt = new Date(now()).toISOString();
          } catch (backupError) {
            if (backupError instanceof LiveSportsError && backupError.status === 429) {
              nhlBackoffUntil = now() + 30_000;
            }
          }
        }
        const previousBackup = leagueResults.get(config.id);
        if (!scoresUpdatedAt && previousBackup?.league.scoresUpdatedAt) {
          events = previousBackup.events;
          scoresUpdatedAt = previousBackup.league.scoresUpdatedAt;
        }
      }
      if (!retained) lastGood.delete(config.id);
      leagueDueAt.set(config.id, backupRefreshed
        ? now() + LIVE_SCORE_REFRESH_MS
        : Math.max(now() + SCORE_RETRY_MS, rateLimited && !scoresUpdatedAt ? rateLimitEnds : 0));
      leagueResults.set(config.id, {
        events,
        golf: retained ? previous.golf : undefined,
        league: {...metadata, status: retained ? 'stale' : 'error', error: message, lastSuccessAt, scoresUpdatedAt},
      });
    }
  }

  function loadLeague(config: (typeof LIVE_LEAGUES)[number]): Promise<void> {
    const current = leagueLoads.get(config.id);
    if (current) return current;
    const pending = updateLeague(config).finally(() => { leagueLoads.delete(config.id); });
    leagueLoads.set(config.id, pending);
    return pending;
  }

  async function refreshBoard(target?: (typeof LIVE_LEAGUES)[number]): Promise<LiveBoard> {
    const started = now();
    const leagues = target ? [target] : LIVE_LEAGUES.filter(league => (leagueDueAt.get(league.id) ?? 0) <= started);
    let index = 0;
    await Promise.all(Array.from({length: Math.min(4, leagues.length)}, async () => {
      while (index < leagues.length) await loadLeague(leagues[index++]);
    }));
    const results = LIVE_LEAGUES.map(config => leagueResults.get(config.id)!);
    const timestamps = results.flatMap(({league}) => league.status !== 'error' && league.lastSuccessAt
      ? [Date.parse(league.lastSuccessAt)] : []);
    const expires = Math.min(...leagueDueAt.values());
    const board: LiveBoard = {
      events: results.flatMap(result => result.events), leagues: results.map(result => result.league),
      golf: results.flatMap(result => result.golf ?? []),
      fetchedAt: new Date(Math.min(now(), ...timestamps)).toISOString(),
      source: 'ESPN',
      refreshAfterMs: Math.min(SCHEDULE_REFRESH_MS, Math.max(1_000, expires - now())),
      stale: results.some(result => result.league.status === 'stale'),
    };
    boardCache = { value: board, expires };
    return board;
  }

  async function getLiveBoard(league?: string): Promise<LiveBoard> {
    const target = league ? LIVE_LEAGUES.find(config => config.id === league) : undefined;
    if (league && !target) throw new LiveSportsError('Supply one supported league key', 400);
    // Serialize updates so a single-league result cannot replace a newer board refresh.
    while (refreshing) await refreshing;
    if (target && boardCache) {
      const due = (leagueDueAt.get(target.id) ?? 0) <= now();
      const canRetry = leagueResults.get(target.id)?.league.status !== 'ok' && (retryAfter.get(target.id) ?? 0) <= now();
      if (due || canRetry) {
        retryAfter.set(target.id, now() + LIVE_SCORE_REFRESH_MS);
        refreshing = refreshBoard(target).finally(() => { refreshing = undefined; });
        await refreshing;
      }
    } else if (!boardCache || boardCache.expires <= now()) {
      refreshing = refreshBoard().finally(() => { refreshing = undefined; });
      await refreshing;
    }
    const copy = structuredClone(boardCache!.value);
    copy.refreshAfterMs = Math.min(SCHEDULE_REFRESH_MS, Math.max(1_000, boardCache!.expires - now()));
    if (copy.leagues.every(item => item.status === 'error')) throw new LiveSportsError('ESPN scoreboards unavailable', 502, copy);
    return copy;
  }

  async function loadEvent(league: string, id: string): Promise<LiveEvent | null> {
    const config = leagueConfig(league);
    if (config.sport === 'tennis' || config.sport === 'mma') {
      const current = lastGood.get(league);
      const live = current?.events.some(event => event.status === 'live');
      if (!current || now() - current.at >= (live ? LIVE_SCORE_REFRESH_MS : SCHEDULE_REFRESH_MS)) {
        if (!leagueRequests.has(league)) leagueRequests.set(league, request(scoreboardPath(config, now())).then(payload => {
          const events = normalizeScoreboard(league, payload);
          lastGood.set(league, { events, at: now() });
          return events;
        }).finally(() => { leagueRequests.delete(league); }));
        return (await leagueRequests.get(league)!).find(event => event.id === id) ?? null;
      }
      return current.events.find(event => event.id === id) ?? null;
    }
    if ((summaryBackoffUntil.get(league) ?? 0) > now()) throw new LiveSportsError('ESPN HTTP 429', 429);
    const payload = await request(`${config.path}/summary?event=${encodeURIComponent(id)}`, true).catch((error: unknown) => {
      if (error instanceof LiveSportsError && error.status === 429) summaryBackoffUntil.set(league, now() + 30_000);
      throw error;
    });
    if (payload === null) return null;
    const data = object(payload);
    const events = normalizeScoreboard(league, { events: [data.header] });
    const event = events.find(event => event.id === id);
    if (!event) throw new LiveSportsError('ESPN event identity mismatch');
    const venue = text(object(object(data.gameInfo).venue).fullName).trim();
    const hasStarted = event.status === 'live' || event.completed;
    const teamStats = hasStarted ? normalizeBoxScore(data, event) : [];
    const playerStats = hasStarted ? normalizePlayerStats(data, event) : undefined;
    const publishedLeaders = normalizeGameLeaders(data,event);
    const leaders = hasStarted ? publishedLeaders : [];
    const pregameLeaders = event.status === 'scheduled' ? publishedLeaders.filter(category=>
      ['pointsPerGame','reboundsPerGame','assistsPerGame'].includes(category.key)
    ) : [];
    const scoringPlays = hasStarted ? normalizeScoringPlays(data, event) : [];
    const timeline = hasStarted ? normalizeTimeline(data, event) : [];
    const soccerCommentary = hasStarted && event.sport === 'soccer' ? normalizeSoccerCommentary(data) : [];
    const matchup = normalizeMatchup(data, event);
    const soccerLineups = normalizeSoccerLineups(data,event);
    const soccerStandings = event.sport === 'soccer' ? normalizeSoccerStandings(data,event) : [];
    const nbaStandings = league === 'nba' ? normalizeNbaStandings(data,event) : [];
    const footballPosition = normalizeDrivePosition(data,event);
    const footballDrives = hasStarted && event.sport === 'football' ? normalizeFootballDrives(data,event) : [];
    return {
      ...event,
      ...(venue ? { venue: venue.slice(0, 160) } : {}),
      ...(footballPosition ? {footballPosition} : {}),
      ...(footballDrives.length ? {footballDrives} : {}),
      ...(teamStats.length ? { teamStats } : {}),
      ...(playerStats ? { playerStats } : {}),
      ...(leaders.length ? {leaders} : {}),
      ...(pregameLeaders.length ? {pregameLeaders} : {}),
      ...(scoringPlays.length ? { scoringPlays } : {}),
      ...(timeline.length ? { timeline } : {}),
      ...(soccerCommentary.length ? { soccerCommentary } : {}),
      ...(matchup ? { matchup } : {}),
      ...(soccerLineups ? {soccerLineups} : {}),
      ...(soccerStandings.length ? {soccerStandings} : {}),
      ...(nbaStandings.length ? {nbaStandings} : {}),
    };
  }

  async function getLiveEvent(league: string, id: string): Promise<LiveEvent | null> {
    const config = leagueConfig(league);
    if (!validId(id)) throw new LiveSportsError('Invalid event id', 400);
    if (config.sport === 'golf') throw new LiveSportsError('PGA leaderboard is not a two-sided contest', 400);
    const key = `${league}:${id}`;
    const cached = details.get(key);
    if (cached && cached.expires > now()) return structuredClone(cached.event);
    if (!detailRequests.has(key)) detailRequests.set(key, loadEvent(league, id).then(event => {
      details.set(key, {
        event, expires: now() + (event?.status === 'live' ? LIVE_SCORE_REFRESH_MS : SCHEDULE_REFRESH_MS),
      });
      return event;
    }).finally(() => { detailRequests.delete(key); }));
    return structuredClone(await detailRequests.get(key)!);
  }

  function getCachedScoreboardEvent(league: string, id: string) {
    const cached = lastGood.get(league);
    if (!cached || now() - cached.at > 300_000) return null;
    const backup = leagueResults.get(league);
    const scoresUpdatedAt = backup?.league.scoresUpdatedAt;
    const event = scoresUpdatedAt ? backup?.events.find(event => event.id === id && event.scoreSource === 'NHL') : undefined;
    if (event) return {event: structuredClone(event), lastSuccessAt: scoresUpdatedAt!};
    const primary = cached.events.find(event => event.id === id);
    return primary ? {event: structuredClone(primary), lastSuccessAt: new Date(cached.at).toISOString()} : null;
  }

  async function getScoreboardEvent(league: string, id: string) {
    const config = leagueConfig(league);
    if ((leagueDueAt.get(league) ?? 0) <= now()) await loadLeague(config);
    return getCachedScoreboardEvent(league, id);
  }

  return { getLiveBoard, getLiveEvent, getScoreboardEvent };
}

const client = createLiveSportsClient();
export const getLiveBoard = (league?: string): Promise<LiveBoard> => client.getLiveBoard(league);
export const getLiveEvent = (league: string, id: string): Promise<LiveEvent | null> => client.getLiveEvent(league, id);
export const getScoreboardEvent = client.getScoreboardEvent;
