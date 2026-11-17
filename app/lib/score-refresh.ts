export const LIVE_SCORE_REFRESH_MS = 1_500;
export const SCHEDULE_REFRESH_MS = 8_000;
export const SCORE_RETRY_MS = 5_000;

type RefreshableScores = {
  events: readonly {status: string; startsAt: string}[];
  golf?: readonly {state: string}[];
};

export function hasActiveScores({events, golf}: RefreshableScores, at: number): boolean {
  return events.some(event => event.status === 'live' ||
    (event.status === 'scheduled' && Math.abs(Date.parse(event.startsAt) - at) <= 60_000)) ||
    Boolean(golf?.some(tournament => tournament.state === 'in'));
}
