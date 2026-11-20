import { AccountError, type StoredParlay } from "./account-store";
import type { AccountBackend } from "./store-backend";
import { LIVE_LEAGUES, type LiveEvent } from "./live-sports";
import { pickName, pickSides, postedPrice, type PickMarket, type PickSide } from "./pick-outcomes";
import { settleParlay, type ParlayTicket, type ParlayLeg, validateParlayLegs, checkCorrelation, generateParlayId, calculateCombinedOdds, calculatePotentialPayout } from "./parlay";
import type { ParlayInput } from "./parlay";

export type RealParlayTicket = {
  id: string;
  legs: ParlayLeg[];
  combinedOdds: number;
  stake: number;
  potentialPayout: number;
  status: "open" | "won" | "lost" | "void" | "cancelled";
  createdAt: string;
  settledAt: string | null;
  entryId: string;
  userId: string;
  requestId: string;
};

export type EventGetter = (league: string, id: string) => Promise<LiveEvent | null>;

export function publicParlayTicket(parlay: StoredParlay): RealParlayTicket {
  return {
    id: parlay.id,
    legs: parlay.legs,
    combinedOdds: parlay.combinedOdds,
    stake: parlay.stake,
    potentialPayout: parlay.potentialPayout,
    status: parlay.status,
    createdAt: parlay.createdAt,
    settledAt: parlay.settledAt,
    entryId: parlay.entryId,
    userId: parlay.userId,
    requestId: "",
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
      if (!event) throw new AccountError("event_unavailable", `Event ${leg.eventId} not found.`);
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
    const stake = 100;
    const potentialPayout = combinedOdds > 0 ? calculatePotentialPayout(stake, combinedOdds) : 0;

    const parlayId = generateParlayId();
    const entryId = parlayId;
    const now = new Date(this.now()).toISOString();
    const saved = await this.store.saveParlay(token, {
      id: parlayId,
      legs: legsWithDetails,
      entryId,
      userId: user.id,
      createdAt: now,
      status: "open",
      settledAt: null,
      combinedOdds,
      stake,
      potentialPayout,
    });
    return publicParlayTicket(saved[0]);
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
      results.set(key, await this.getEvent(league, eventId));
    }

    const settledAt = new Date(this.now()).toISOString();
    const updates: Array<{ id: string; status: StoredParlay["status"]; settledAt: string }> = [];

    for (const parlay of openParlays) {
      const ticket: ParlayTicket = {
        id: parlay.id,
        legs: parlay.legs,
        combinedOdds: 0,
        stake: 100,
        potentialPayout: 0,
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
              : marketResult(leg, event);
            legResults.set(`${leg.league}:${leg.eventId}:${leg.market}:${leg.side}`, legWinner);
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
    return this.list(token);
  }
}

function validParticipants(event: LiveEvent): boolean {
  return event.home.id !== "" && event.away.id !== "" && event.home.name !== "" && event.away.name !== "";
}

function marketResult(leg: ParlayLeg, event: LiveEvent): "won" | "lost" {
  if (leg.market === "spread") {
    const spread = event.odds?.spread;
    if (spread === null || spread === undefined) return "lost";
    const homeCover = event.home.score !== null && event.away.score !== null
      ? (event.home.score - event.away.score) > spread
      : false;
    return leg.side === "home" ? (homeCover ? "won" : "lost") : (!homeCover ? "won" : "lost");
  }
  if (leg.market === "total") {
    const total = event.odds?.total;
    if (total === null || total === undefined) return "lost";
    const over = event.home.score !== null && event.away.score !== null
      ? (event.home.score + event.away.score) > total
      : false;
    return leg.side === "over" ? (over ? "won" : "lost") : (!over ? "won" : "lost");
  }
  return "lost";
}
