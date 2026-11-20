import type { StoredPick } from "./account-store";
import type { PickSide } from "./pick-outcomes";

export type PickConsensusEntry = { home: number; away: number; draw: number; total: number };
export type PickConsensus = Record<string, PickConsensusEntry>;

// Percentages derived from very small groups can identify an individual's pick,
// so an event only reports consensus once enough pickers have weighed in.
export const CONSENSUS_MINIMUM = 5;

export function consensusKey(league: string, eventId: string): string {
  return `${league}:${eventId}`;
}

export function consensusPercent(entry: PickConsensusEntry | undefined, side: PickSide): number | null {
  if (!entry || entry.total < CONSENSUS_MINIMUM || side === "over" || side === "under") return null;
  const count = entry[side];
  if (!count) return 0;
  return Math.round((count / entry.total) * 100);
}

export function buildPickConsensus(tickets: StoredPick[]): PickConsensus {
  const counts = new Map<string, { home: number; away: number; draw: number }>();
  for (const ticket of tickets) {
    // Voided and cancelled picks are not calls on the game. Consensus covers
    // moneyline picks only; spread/total percentages would mix denominators.
    if (ticket.status === "void" || ticket.status === "cancelled" || (ticket.market ?? "moneyline") !== "moneyline") continue;
    const key = consensusKey(ticket.league, ticket.eventId);
    const entry = counts.get(key) ?? { home: 0, away: 0, draw: 0 };
    if (ticket.side === "home" || ticket.side === "away" || ticket.side === "draw") entry[ticket.side] += 1;
    counts.set(key, entry);
  }
  const consensus: PickConsensus = {};
  for (const [key, entry] of counts) {
    const total = entry.home + entry.away + entry.draw;
    if (total >= CONSENSUS_MINIMUM) consensus[key] = { ...entry, total };
  }
  return consensus;
}
