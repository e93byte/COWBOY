import type { LiveBoard, LiveEvent } from './live-sports';
import { SCORE_RETRY_MS } from './score-refresh';
import { deriveLiveState, type CanonicalLiveState, type ClockState } from './live-state';

export type SportTemplate =
  | 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer' | 'tennis' | 'mma' | 'standard';
export type EventFreshness = 'current' | 'backup-current' | 'delayed' | 'unavailable';

export type EventPresentation = {
  key: string;
  gamePhase: LiveEvent['status'];
  template: SportTemplate;
  freshness: EventFreshness;
  lastConfirmedAt?: string;
  freshnessLabel: string;
  pickEligible: boolean;
  pickReason: string | null;
  capabilities: ReadonlySet<string>;
  /** Canonical per-event state from deriveLiveState (scheduled/pregame/live/halftime/final/…). */
  liveState: CanonicalLiveState;
  /** Provider clock integrity: running only while genuinely in progress. */
  clockState: ClockState;
  /** True when the confirming feed is older than the stale threshold for a live event. */
  clockStale: boolean;
  clockAgeMs: number | null;
};

type LeagueState = LiveBoard['leagues'][number] | undefined;

export function eventKey(event: Pick<LiveEvent, 'league' | 'id'>) {
  return `${event.league}:${event.id}`;
}

export function sportTemplate(sport: string): SportTemplate {
  return (['football', 'basketball', 'baseball', 'hockey', 'soccer', 'tennis', 'mma'] as const)
    .find(template => template === sport) ?? 'standard';
}

export function eventCapabilities(event: LiveEvent): ReadonlySet<string> {
  const values = new Set<string>(['scoreboard', 'overview']);
  if (event.away.linescores?.length || event.home.linescores?.length) values.add('period-scores');
  if (event.teamStats?.length) values.add('team-stats');
  if (event.playerStats?.away.length || event.playerStats?.home.length) values.add('player-stats');
  if (event.leaders?.length || event.pregameLeaders?.length) values.add('leaders');
  if (event.scoringPlays?.length || event.timeline?.length || event.soccerCommentary?.length) values.add('timeline');
  if (event.footballPosition) values.add('possession');
  if (event.footballDrives?.length) values.add('drives');
  if (event.onIce) values.add('on-ice');
  if (event.soccerLineups) values.add('lineups');
  if (event.fight) values.add('fight-card');
  if (event.odds || event.oddsBooks?.length) values.add('reference-lines');
  return values;
}

function freshnessFor(event: LiveEvent, league: LeagueState, boardError: boolean, now: number): {
  freshness: EventFreshness; lastConfirmedAt?: string;
} {
  const backupAt = event.scoreSource === league?.backupSource && event.scoreSource ? league?.scoresUpdatedAt : undefined;
  const lastConfirmedAt = backupAt ?? league?.lastSuccessAt;
  if (boardError || !league || league.status === 'error') return { freshness: 'unavailable', lastConfirmedAt };
  if (league.status === 'ok') return { freshness: 'current', lastConfirmedAt };
  const age = backupAt ? now - Date.parse(backupAt) : Infinity;
  return { freshness: age >= 0 && age <= SCORE_RETRY_MS ? 'backup-current' : 'delayed', lastConfirmedAt };
}

export function presentEvent(event: LiveEvent, options: {
  league?: LeagueState;
  now: number;
  boardError?: boolean;
  selfExcluded?: boolean;
  dailyLimitReached?: boolean;
}): EventPresentation {
  const { freshness, lastConfirmedAt } = freshnessFor(event, options.league, Boolean(options.boardError), options.now);
  let pickReason: string | null = null;
  if (options.selfExcluded) pickReason = 'Picks are paused while self-exclusion is active.';
  else if (options.dailyLimitReached) pickReason = 'Your daily free-pick limit has been reached.';
  else if (event.status !== 'scheduled' || !Number.isFinite(Date.parse(event.startsAt)) || Date.parse(event.startsAt) <= options.now) {
    pickReason = 'Picks are closed for this game.';
  } else if (freshness === 'unavailable') {
    pickReason = 'Picks are unavailable because this game cannot be verified right now.';
  } else if (freshness === 'backup-current') {
    pickReason = 'Picks resume when the game can be verified for entry.';
  } else if (freshness === 'delayed') {
    pickReason = 'Picks are paused while updates for this game are delayed.';
  }
  const freshnessLabel = freshness === 'current' ? 'Updated'
    : freshness === 'backup-current' ? 'Backup score current'
    : freshness === 'delayed' ? 'Updates delayed'
    : 'Updates unavailable';
  // Per-event clock integrity: a provider can keep returning HTTP 200 with a
  // frozen clock, so league-level freshness alone is not enough. The age is
  // measured from lastConfirmedAt (the same timestamp freshness uses); when it
  // is unknown the clock is unknown — never assumed fresh. Backup feeds poll
  // slower, so they get a wider stale window rather than false alarms.
  const live = deriveLiveState(event, {
    fetchedAt: lastConfirmedAt ?? null,
    now: options.now,
    staleAfterMs: freshness === 'backup-current' ? 300_000 : freshness === 'current' ? 30_000 : undefined,
  });
  const clockStale = (live.state === 'live' || live.state === 'halftime' || live.state === 'intermission')
    && live.clock.stale;
  return {
    key: eventKey(event), gamePhase: event.status, template: sportTemplate(event.sport), freshness, lastConfirmedAt,
    freshnessLabel, pickEligible: pickReason === null, pickReason,
    capabilities: eventCapabilities(event),
    liveState: live.state, clockState: live.clock.state,
    clockStale, clockAgeMs: live.clock.ageMs,
  };
}
