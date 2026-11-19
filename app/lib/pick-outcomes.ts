export type PickSide = 'home' | 'away' | 'draw';

const drawLeagues = new Set(['epl', 'efl', 'laliga', 'bundesliga', 'bl2', 'bl3', 'dfb_pokal', 'seriea', 'ligue1', 'ligue2', 'brasileirao', 'ligamx', 'argentina', 'aleague', 'nationsleague', 'concacafnl', 'afconqual', 'nwsl', 'wsl']);
const teamSides = ['away', 'home'] as const;
const soccerSides = ['away', 'home', 'draw'] as const;

export function supportsDrawPick(league: string) {
  return drawLeagues.has(league);
}

export function pickSides(league: string): readonly PickSide[] {
  return supportsDrawPick(league) ? soccerSides : teamSides;
}

export function pickName(
  event: {home: {name: string; shortName: string}; away: {name: string; shortName: string}},
  side: PickSide, field: 'name' | 'shortName' = 'name',
) {
  return side === 'draw' ? 'Draw' : event[side][field];
}
