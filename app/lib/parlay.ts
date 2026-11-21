import type { PickMarket, PickSide } from "./pick-outcomes";
import type { LiveEvent } from "./live-sports";

export type ParlayLeg = {
  eventId: string;
  league: string;
  market: PickMarket;
  side: PickSide;
  line: number | null;
  odds: number;
  eventName: string;
  startsAt: string;
  sport: string;
};

export type ParlayTicket = {
  id: string;
  legs: ParlayLeg[];
  combinedOdds: number;
  status: "open" | "won" | "lost" | "void" | "cancelled";
  createdAt: string;
  settledAt: string | null;
  entryId: string;
  userId: string;
  requestId: string;
};

export type ParlayInput = {
  chipStake?: number;
  legs: Array<{
    eventId: string;
    league: string;
    market: PickMarket;
    side: PickSide;
    line: number | null;
    requestId: string;
  }>;
};

export type CorrelationCheck = {
  allowed: boolean;
  reason?: string;
  correlatedGroups: Array<{ legIndices: number[]; reason: string }>;
};

export function americanToDecimal(american: number): number {
  if (american > 0) return 1 + american / 100;
  if (american < 0) return 1 + 100 / Math.abs(american);
  return 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function calculateCombinedOdds(legs: ParlayLeg[]): number {
  const decimalOdds = legs.map((leg) => americanToDecimal(leg.odds));
  const combined = decimalOdds.reduce((acc, odds) => acc * odds, 1);
  return decimalToAmerican(combined);
}

export function validateParlayLegs(legs: ParlayLeg[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (legs.length < 2) errors.push("Parlay requires at least 2 legs");
  if (legs.length > 10) errors.push("Parlay cannot exceed 10 legs");
  const eventKeys = new Set(legs.map((l) => `${l.league}:${l.eventId}:${l.market}`));
  if (eventKeys.size !== legs.length) errors.push("Duplicate leg (same event and market)");
  const now = Date.now();
  for (const leg of legs) {
    if (Date.parse(leg.startsAt) <= now) errors.push(`Event ${leg.eventName} has already started`);
  }
  return { valid: errors.length === 0, errors };
}

function sameGame(leg1: ParlayLeg, leg2: ParlayLeg): boolean {
  return leg1.league === leg2.league && leg1.eventId === leg2.eventId;
}

function sameTeam(leg1: ParlayLeg, leg2: ParlayLeg): boolean {
  if (!sameGame(leg1, leg2)) return false;
  const team1 = leg1.side === "home" || leg1.side === "away" ? leg1.side : null;
  const team2 = leg2.side === "home" || leg2.side === "away" ? leg2.side : null;
  return team1 !== null && team1 === team2;
}

function opposingSides(leg1: ParlayLeg, leg2: ParlayLeg): boolean {
  if (!sameGame(leg1, leg2)) return false;
  if (leg1.market !== leg2.market) return false;
  return (
    (leg1.side === "home" && leg2.side === "away") ||
    (leg1.side === "away" && leg2.side === "home") ||
    (leg1.side === "over" && leg2.side === "under") ||
    (leg1.side === "under" && leg2.side === "over")
  );
}

export function checkCorrelation(legs: ParlayLeg[]): CorrelationCheck {
  const correlatedGroups: CorrelationCheck["correlatedGroups"] = [];
  const n = legs.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameGame(legs[i], legs[j])) {
        if (opposingSides(legs[i], legs[j])) {
          correlatedGroups.push({
            legIndices: [i, j],
            reason: "Opposing sides on same game/market",
          });
        } else if (sameTeam(legs[i], legs[j]) && legs[i].market !== legs[j].market) {
          correlatedGroups.push({
            legIndices: [i, j],
            reason: "Same team across different markets (SGP correlation)",
          });
        } else if (legs[i].market === legs[j].market && legs[i].side === legs[j].side) {
          correlatedGroups.push({
            legIndices: [i, j],
            reason: "Duplicate selection",
          });
        }
      }
    }
  }
  const blocking = correlatedGroups.filter((g) =>
    g.reason === "Opposing sides on same game/market" || g.reason === "Duplicate selection"
  );
  return {
    allowed: blocking.length === 0,
    reason: blocking.length > 0 ? blocking[0].reason : undefined,
    correlatedGroups,
  };
}

export function settleParlay(ticket: ParlayTicket, results: Map<string, "won" | "lost" | "void">): "won" | "lost" | "void" {
  let hasVoid = false;
  for (const leg of ticket.legs) {
    const key = `${leg.league}:${leg.eventId}:${leg.market}:${leg.side}`;
    const result = results.get(key);
    if (result === "lost") return "lost";
    if (result === "void") hasVoid = true;
  }
  return hasVoid ? "void" : "won";
}

export function generateParlayId(): string {
  return `parlay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}