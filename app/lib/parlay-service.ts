import { AccountError, type StoredParlay } from "./account-store";
import type { AccountBackend } from "./store-backend";
import { LIVE_LEAGUES, type LiveEvent } from "./live-sports";
import { pickName, pickSides, postedPrice, type PickMarket, type PickSide } from "./pick-outcomes";
import { settleParlay, type ParlayTicket, type ParlayLeg, validateParlayLegs, checkCorrelation, generateParlayId, calculateCombinedOdds, americanToDecimal } from "./parlay";
import type { ParlayInput } from "./parlay";

export type RealParlayTicket = {
  id: string;
  legs: ParlayLeg[];
  combinedOdds: number;
  status: "open" | "won" | "lost" | "void" | "cancelled";
  createdAt: string;
  settledAt: string | null;
  entryId: string;
  userId: string;
  requestId: string;
  /** Optional play-money chip stake escrowed at submission; no cash value. */
  chipStake?: number;
};

export type EventGetter = (league: string, id: string) => Promise<LiveEvent | null>;

export function publicParlayTicket(parlay: StoredParlay): RealParlayTicket {
  return {
    id: parlay.id,
    legs: parlay.legs,
    combinedOdds: parlay.combinedOdds,
    status: parlay.status,
    createdAt: parlay.createdAt,
    settledAt: parlay.settledAt,
    entryId: parlay.entryId,
    userId: parlay.userId,
    requestId: "",
    ...(parlay.chipStake ? { chipStake: parlay.chipStake } : {}),
  };
}

export class ParlayService {
  private store: AccountBackend;
  private getEvent: EventGetter;
  private now: () => number;

  constructor({ store, getEvent, now = Date.now }: { store: AccountBackend; getEvent: EventGetter; now?: () => number }) {
    this.store = store;
    this.getEvent = getEvent;
    this.now = now;
  }

  async list(token: string | null): Promise<RealParlayTicket[]> {
    const stored = await this.store.listParlays(token);
    return stored.map(publicParlayTicket);
  }

  async submit(token: string | null, input: ParlayInput): Promise<RealParlayTicket> {
    const user = await this.store.getUser(token);
    if (!user) throw new AccountError("unauthorized", "Sign in to save parlays.", 401);

    const { legs } = input;
    const inputValidation = validateParlayLegs(legs as unknown as ParlayLeg[]);
    if (!inputValidation.valid) throw new AccountError("invalid_input", inputValidation.errors.join(", "));
    const inputCorrelation = checkCorrelation(legs as unknown as ParlayLeg[]);
    if (!inputCorrelation.allowed) throw new AccountError("invalid_input", inputCorrelation.reason ?? "Correlated legs not allowed.");

    const events = await Promise.all(legs.map((l) => this.getEvent(l.league, l.eventId)));
    const legsWithDetails: ParlayLeg[] = legs.map((leg, i) => {
      const event = events[i];
      if (!event || event.scoreSource || event.id !== leg.eventId || event.league !== leg.league) {
        throw new AccountError("event_unavailable", "A selected game cannot be verified for entry.", 409);
      }
      if (event.status !== "scheduled" || Date.parse(event.startsAt) <= this.now()) throw new AccountError("event_locked", `Event ${event.name} has started.`);
      const odds = event.odds ? postedPrice(event.odds, leg.side, leg.market) : null;
      return {
        eventId: leg.eventId,
        league: leg.league,
        market: leg.market,
        side: leg.side,
        line: leg.line,
        odds: odds ?? -110,
        eventName: event.name,
        startsAt: event.startsAt,
        sport: event.sport ?? "",
      };
    });

    const legValidation = validateParlayLegs(legsWithDetails);
    if (!legValidation.valid) throw new AccountError("invalid_input", legValidation.errors.join(", "));
    const legCorrelation = checkCorrelation(legsWithDetails);
    if (!legCorrelation.allowed) throw new AccountError("invalid_input", legCorrelation.reason ?? "Correlated legs not allowed.");

    const combinedOdds = legsWithDetails.length >= 2 ? calculateCombinedOdds(legsWithDetails) : 0;
    const chipStake = input.chipStake ?? 0;
    if (!Number.isSafeInteger(chipStake) || chipStake < 0 || chipStake > 1000000) {
      throw new AccountError("invalid_input", "chipStake must be a whole number of chips between 0 and 1,000,000.");
    }
    if (chipStake > 0 && !Number.isFinite(combinedOdds)) {
      throw new AccountError("event_unavailable", "Chip stakes need a posted price for every leg. No parlay was saved.");
    }

    const parlayId = generateParlayId();
    const entryId = parlayId;
    const now = new Date(this.now()).toISOString();
    try {
      if (chipStake > 0) {
        await this.store.adjustTokens(token, user.id, -chipStake, "chip_stake", `chip_stake:${parlayId}`);
      }
      const saved = await this.store.saveParlay(token, {
        id: parlayId,
        legs: legsWithDetails,
        entryId,
        userId: user.id,
        createdAt: now,
        status: "open",
        settledAt: null,
        combinedOdds,
        chipStake,
      });
      return publicParlayTicket(saved[0]);
    } catch (error) {
      if (chipStake > 0) {
        try {
          await this.store.adjustTokens(token, user.id, chipStake, "chip_stake_refund", `chip_stake_refund:${parlayId}`);
        } catch { /* balance already restored or session gone */ }
      }
      throw error;
    }
  }

  async refresh(token: string | null): Promise<RealParlayTicket[]> {
    const stored = await this.store.listParlays(token);
    const user = await this.store.getUser(token);
    if (!user) throw new AccountError("unauthorized", "Sign in to manage your parlays.", 401);

    const byId = new Map(stored.map((p) => [p.id, p]));
    const openParlays = stored.filter((p) => p.status === "open");
    if (openParlays.length === 0) return this.list(token);

    const results = new Map<string, LiveEvent | null>();
    const legKeys = new Set<string>();
    for (const parlay of openParlays) {
      for (const leg of parlay.legs) {
        legKeys.add(`${leg.league}:${leg.eventId}`);
      }
    }

    for (const key of legKeys) {
      const [league, eventId] = key.split(":");
      const event = await this.getEvent(league, eventId);
      results.set(key, event && !event.scoreSource && event.id === eventId && event.league === league ? event : null);
    }

    const settledAt = new Date(this.now()).toISOString();
    const updates: Array<{ id: string; status: StoredParlay["status"]; settledAt: string }> = [];

    for (const parlay of openParlays) {
      const ticket: ParlayTicket = {
        id: parlay.id,
        legs: parlay.legs,
        combinedOdds: 0,
        status: "open",
        createdAt: parlay.createdAt,
        settledAt: null,
        entryId: parlay.entryId,
        userId: parlay.userId,
        requestId: "",
      };

      const legResults = new Map<string, "won" | "lost" | "void">();
      let allLegsResolved = true;

      for (const leg of parlay.legs) {
        const eventKey = `${leg.league}:${leg.eventId}`;
        const event = results.get(eventKey);
        const storedTicket = byId.get(parlay.id);

        if (!event || !storedTicket || event.id !== leg.eventId || event.league !== leg.league || !validParticipants(event)) {
          allLegsResolved = false;
          continue;
        }

        if (event.status === "cancelled") {
          legResults.set(`${leg.league}:${leg.eventId}:${leg.market}:${leg.side}`, "void");
        } else if (event.status === "final" && event.completed === true) {
          if (["home", "away", "draw"].includes(event.winner ?? "")) {
            const legWinner = leg.market === "moneyline"
              ? (leg.side === event.winner ? "won" : "lost")
              : gradeParlayMarket(leg, event);
            if (legWinner) legResults.set(`${leg.league}:${leg.eventId}:${leg.market}:${leg.side}`, legWinner);
            else allLegsResolved = false;
          } else {
            allLegsResolved = false;
          }
        } else {
          allLegsResolved = false;
        }
      }

      if (allLegsResolved && legResults.size > 0) {
        const outcome = settleParlay(ticket, legResults);
        updates.push({ id: parlay.id, status: outcome, settledAt });
      }
    }

    if (updates.length) await this.store.settleParlays(token, updates);
    // Chip settlement: won pays stake × decimal combined odds, void/cancelled
    // refunds the escrow, lost keeps nothing. One award key per parlay is idempotent.
    for (const parlay of openParlays) {
      const update = updates.find((u) => u.id === parlay.id);
      const stake = parlay.chipStake ?? 0;
      if (!update || stake <= 0) continue;
      const credit = update.status === "won"
        ? (parlay.combinedOdds ? Math.round(stake * americanToDecimal(parlay.combinedOdds)) : 0)
        : update.status === "void" || update.status === "cancelled" ? stake : 0;
      if (credit > 0) {
        await this.store.awardTokens(token, user.id, credit,
          update.status === "won" ? "chip_win" : "chip_refund", `chip_result:${parlay.id}`);
      }
    }
    return this.list(token);
  }
}

function validParticipants(event: LiveEvent): boolean {
  return event.home.id !== "" && event.away.id !== "" && event.home.name !== "" && event.away.name !== "";
}

/** Grade against the exact line saved with the free pick, never a later feed line. */
export function gradeParlayMarket(leg: ParlayLeg, event: LiveEvent): "won" | "lost" | "void" | null {
  const homeScore = event.home.score;
  const awayScore = event.away.score;
  if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) return null;
  if (leg.market === "spread") {
    if (leg.line === null || leg.line === undefined) return null;
    const margin = leg.side === "home" ? homeScore - awayScore : awayScore - homeScore;
    const differential = margin + leg.line;
    return differential > 0 ? "won" : differential < 0 ? "lost" : "void";
  }
  if (leg.market === "total") {
    if (leg.line === null || leg.line === undefined) return null;
    const differential = leg.side === "over" ? homeScore + awayScore - leg.line : leg.line - (homeScore + awayScore);
    return differential > 0 ? "won" : differential < 0 ? "lost" : "void";
  }
  return null;
}
