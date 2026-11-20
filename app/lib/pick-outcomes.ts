import type { GameOdds } from "./live-sports";

export type PickMarket = 'moneyline' | 'spread' | 'total';
export type PickSide = 'home' | 'away' | 'draw' | 'over' | 'under';

const drawLeagues = new Set(['epl', 'efl', 'laliga', 'bundesliga', 'bl2', 'bl3', 'dfb_pokal', 'seriea', 'ligue1', 'ligue2', 'brasileirao', 'ligamx', 'argentina', 'aleague', 'nationsleague', 'concacafnl', 'afconqual', 'nwsl', 'wsl']);
const moneylineSides = ['away', 'home'] as const;
const soccerSides = ['away', 'home', 'draw'] as const;
const spreadSides = ['away', 'home'] as const;
const totalSides = ['over', 'under'] as const;

export function supportsDrawPick(league: string) {
  return drawLeagues.has(league);
}

export function pickSides(league: string, market: PickMarket = 'moneyline'): readonly PickSide[] {
  if (market === 'total') return totalSides;
  if (market === 'spread') return spreadSides;
  return supportsDrawPick(league) ? soccerSides : moneylineSides;
}

export function pickName(
  event: {home: {name: string; shortName: string}; away: {name: string; shortName: string}},
  side: PickSide, field: 'name' | 'shortName' = 'name',
  market: PickMarket = 'moneyline', line?: number | null,
) {
  if (market === 'total') {
    const label = side === 'over' ? 'Over' : 'Under';
    return line === null || line === undefined ? label : `${label} ${line}`;
  }
  const team = side === 'draw' ? 'Draw' : event[side as 'home' | 'away'][field];
  if (market === 'spread' && line !== null && line !== undefined) {
    return `${team} ${line > 0 ? '+' : ''}${line}`;
  }
  return team;
}

// The line a pick will be stored against, mirroring pick-service.marketLine:
// the home spread is signed, so the away side receives the inverse.
export function postedPickLine(odds: GameOdds | undefined, side: PickSide, market: PickMarket): number | null {
  if (!odds) return null;
  if (market === 'spread') {
    const spread = odds.spread;
    if (spread === null || spread === undefined) return null;
    return side === 'home' ? spread : -spread;
  }
  if (market === 'total') return odds.total ?? null;
  return null;
}
