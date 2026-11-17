import type {LiveEvent} from './live-sports';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Match both clubs in order and the exact scheduled time, including doubleheaders. */
export function applyMlbScores(events: LiveEvent[], payload: unknown): LiveEvent[] {
  const dates = record(payload).dates;
  if (!Array.isArray(dates)) return events;
  const games = dates.flatMap(day => {
    const entries = record(day).games;
    return Array.isArray(entries) ? entries.map(record) : [];
  });
  return events.map(event => {
    if (event.status !== 'live' && event.status !== 'scheduled') return event;
    const matches = games.filter(game => {
      if (typeof game.gameDate !== 'string' || Date.parse(game.gameDate) !== Date.parse(event.startsAt)) return false;
      const teams = record(game.teams);
      return (['away','home'] as const).every(side => {
        const team = record(record(teams[side]).team);
        return team.abbreviation === event[side].shortName || team.name === event[side].name;
      });
    });
    if (matches.length !== 1) return event;
    const [game] = matches;
    const status = record(game.status);
    const live = status.abstractGameState === 'Live' && status.detailedState === 'In Progress';
    const final = status.abstractGameState === 'Final' && status.detailedState === 'Final';
    if (!live && !final) return event;
    const teams = record(game.teams);
    const away = record(teams.away).score;
    const home = record(teams.home).score;
    if (!count(away) || !count(home) || (final && away === home)) return event;
    const lines = record(game.linescore);
    const period = count(lines.currentInning) && lines.currentInning > 0 ? lines.currentInning : null;
    const inningState = lines.inningState;
    const hasInning = period !== null && ['Top','Bottom','Middle','End'].includes(String(inningState));
    return {
      ...event, status: final ? 'final' : 'live', statusText: final ? 'Final' : hasInning ? `${inningState} ${period}` : 'In progress',
      clock:null, period,
      away:{...event.away,score:away,linescores:undefined,baseballTotals:undefined},
      home:{...event.home,score:home,linescores:undefined,baseballTotals:undefined},
      scoreSource:'MLB',
    };
  });
}
