import type { GameOdds } from "./live-sports";

export type PickMarket = 'moneyline' | 'spread' | 'total' | 'prop';
export type PickSide = 'home' | 'away' | 'draw' | 'over' | 'under';

/**
 * A player prop selection. Props are reference lines shown by the data feed;
 * the pick records the player, stat and posted number so settlement cannot
 * drift when the board changes.
 */
export type PropSelection = { player: string; stat: string; line: number; book: string };

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
  if (market === 'prop') return totalSides;
  if (market === 'spread') return spreadSides;
  return supportsDrawPick(league) ? soccerSides : moneylineSides;
}

export function pickName(
  event: {home: {name: string; shortName: string}; away: {name: string; shortName: string}},
  side: PickSide, field: 'name' | 'shortName' = 'name',
  market: PickMarket = 'moneyline', line?: number | null,
  prop?: Pick<PropSelection, 'player' | 'stat' | 'line'> | null,
) {
  if (market === 'prop' && prop) {
    const label = side === 'over' ? 'Over' : 'Under';
    return `${prop.player} ${prop.stat} ${label} ${line ?? prop.line}`;
  }
  if (market === 'total' || market === 'prop') {
    const label = side === 'over' ? 'Over' : 'Under';
    return line === null || line === undefined ? label : `${label} ${line}`;
  }
  const team = side === 'draw' ? 'Draw' : event[side as 'home' | 'away'][field];
  if (market === 'spread' && line !== null && line !== undefined) {
    return `${team} ${line > 0 ? '+' : ''}${line}`;
  }
  return team;
}

// Reference price for a selection, in American odds. Free picks display this
// as implied probability; it is never a price the product can accept or pay.
export function postedPrice(odds: GameOdds | undefined, side: PickSide, market: PickMarket): number | null {
  if (!odds) return null;
  if (market === 'moneyline') {
    if (side === 'home') return odds.homeMoneyline ?? null;
    if (side === 'away') return odds.awayMoneyline ?? null;
    if (side === 'draw') return odds.drawMoneyline ?? null;
    return null;
  }
  if (market === 'spread') {
    if (side === 'home') return odds.homeSpreadPrice ?? null;
    if (side === 'away') return odds.awaySpreadPrice ?? null;
    return null;
  }
  if (market === 'total') {
    if (side === 'over') return odds.overPrice ?? null;
    if (side === 'under') return odds.underPrice ?? null;
  }
  return null;
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
