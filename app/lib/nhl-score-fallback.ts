import type { LiveEvent } from './live-sports';

const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function nhlScoreDate(time: number): string {
  return easternDate.format(time);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function goals(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Keep the ESPN event ID and replace only display fields verified by the NHL. */
export function applyNhlScores(events: LiveEvent[], payload: unknown): LiveEvent[] {
  const games = record(payload).games;
  if (!Array.isArray(games)) return events;
  return events.map(event => {
    if (event.status !== 'live' && event.status !== 'scheduled') return event;
    const matches = games.map(record).filter(game =>
      record(game.awayTeam).abbrev === event.away.shortName &&
      record(game.homeTeam).abbrev === event.home.shortName &&
      typeof game.startTimeUTC === 'string' && Date.parse(game.startTimeUTC) === Date.parse(event.startsAt)
    );
    if (matches.length !== 1) return event;
    const [game] = matches;
    const live = game.gameState === 'LIVE' || game.gameState === 'CRIT';
    const final = game.gameState === 'FINAL' || game.gameState === 'OFF';
    if (game.gameScheduleState !== 'OK' || (!live && !final)) return event;
    const away = record(game.awayTeam).score;
    const home = record(game.homeTeam).score;
    if (!goals(away) || !goals(home) || (final && away === home)) return event;
    const periodData = record(game.periodDescriptor);
    const period = goals(periodData.number) && periodData.number > 0 ? periodData.number : null;
    const timeRemaining = record(game.clock).timeRemaining;
    const clock = live && typeof timeRemaining === 'string' && /^\d{1,2}:[0-5]\d$/.test(timeRemaining) ? timeRemaining : null;
    const periodType = periodData.periodType;
    const statusText = final ? 'Final' : periodType === 'SO' ? 'Shootout' :
      periodType === 'OT' ? 'Overtime' : period ? `Period ${period}` : 'In progress';
    return {
      ...event, status: final ? 'final' : 'live', statusText, clock, period,
      away: {...event.away, score: away, linescores: undefined},
      home: {...event.home, score: home, linescores: undefined},
      scoreSource: 'NHL',
    };
  });
}
