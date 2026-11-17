import type {LiveEvent} from './live-sports';

type ScoringPlay = NonNullable<LiveEvent['timeline']>[number];

export type ScoreStep = {
  id: string;
  away: number;
  home: number;
  period: number | null;
  clock: string | null;
  description: string;
};

function stepsFrom(plays: ScoringPlay[]) {
  const steps: ScoreStep[] = [];
  let previous: ScoreStep | undefined;
  for (const play of [...plays].reverse()) {
    const {awayScore,homeScore} = play;
    if (awayScore === null || homeScore === null ||
        !Number.isSafeInteger(awayScore) || !Number.isSafeInteger(homeScore) ||
        awayScore < 0 || homeScore < 0 ||
        (previous?.away === awayScore && previous.home === homeScore)) continue;
    previous = {id:play.id,away:awayScore,home:homeScore,period:play.period,clock:play.clock,description:play.description};
    steps.push(previous);
  }
  return steps;
}

export function scoreProgression(timeline: ScoringPlay[], scoringPlays: ScoringPlay[]) {
  const timelineSteps = stepsFrom(timeline);
  return timelineSteps.length >= 2 ? timelineSteps : stepsFrom(scoringPlays);
}
