import { randomUUID } from "node:crypto";
import { AccountError, AccountStore, type StoredPick } from "./account-store";
import { LIVE_LEAGUES, type LiveEvent } from "./live-sports";
import { pickName, supportsDrawPick, type PickSide } from "./pick-outcomes";
import { buildPickConsensus, type PickConsensus } from "./pick-consensus";

export type PickChange = {
  side: PickSide;
  selection: string;
  changedAt: string;
};

export type RealPickTicket = {
  id: string;
  eventId: string;
  league: string;
  eventName: string;
  selection: string;
  side: PickSide;
  startsAt: string;
  createdAt: string;
  status: "open" | "won" | "lost" | "void" | "cancelled";
  settledAt: string | null;
  changes?: PickChange[];
  /** Present for a multi-game free-picks entry; legacy tickets omit it. */
  entryId?: string;
  entryIndex?: number;
  entrySize?: number;
};
export type EventGetter = (league: string, id: string) => Promise<LiveEvent | null>;
export function publicTicket(ticket: StoredPick): RealPickTicket {
  const { id, eventId, league, eventName, selection, side, startsAt, createdAt, status, settledAt, changes, entryId, entryIndex, entrySize } = ticket;
  return {
    id, eventId, league, eventName, selection, side, startsAt, createdAt, status, settledAt,
    ...(changes ? {changes} : {}),
    ...(entryId ? {entryId, entryIndex, entrySize} : {}),
  };
}

type PickInput = { eventId: string; league: string; side: PickSide; requestId: string };
function validatePick(input: unknown): PickInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AccountError("invalid_input", "Supply an event, league, supported outcome and unique requestId.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((field) => !["eventId", "league", "side", "requestId"].includes(field))
    || typeof value.eventId !== "string" || !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(value.eventId)
    || typeof value.league !== "string" || !LIVE_LEAGUES.some((league) => league.id === value.league && league.sport !== "golf")
    || typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.requestId)
    || (value.side !== "home" && value.side !== "away" && !(value.side === "draw" && supportsDrawPick(value.league)))) {
    throw new AccountError("invalid_input", "Supply an event, league, supported outcome and 8–128 character unique requestId.");
  }
  return value as PickInput;
}
function validParticipants(event: LiveEvent): boolean {
  return !!event.home?.id && !!event.away?.id && event.home.id !== event.away.id
    && !!event.home.name?.trim() && !!event.away.name?.trim();
}
function assertScheduled(event: LiveEvent, now: number) {
  if (event.status !== "scheduled" || event.completed !== false || event.winner !== null
    || !Number.isFinite(Date.parse(event.startsAt)) || Date.parse(event.startsAt) <= now || !validParticipants(event)) {
    throw new AccountError("event_locked", "Only verified scheduled events with real participants accept picks before their start time.", 409);
  }
}

export class PickService {
  private readonly store: AccountStore;
  private readonly getEvent: EventGetter;
  private readonly now: () => number;
  constructor(options: { store: AccountStore; getEvent: EventGetter; now?: () => number }) {
    this.store = options.store; this.getEvent = options.getEvent; this.now = options.now ?? Date.now;
  }

  private async fetchEvent(league: string, id: string) {
    try { return await this.getEvent(league, id); }
    catch { throw new AccountError("feed_unavailable", "The real event provider is unavailable. No pick changes were made.", 409); }
  }

  async list(token: string | null): Promise<RealPickTicket[]> {
    return this.store.transaction((data) => {
      const user = this.store.requireUser(data, token);
      return data.tickets.filter((ticket) => ticket.userId === user.id).map(publicTicket).reverse();
    }, false);
  }

  // Public, anonymous aggregate: counts only, never user identities, and only
  // once enough pickers make the percentages non-identifying.
  async consensus(): Promise<PickConsensus> {
    return this.store.transaction((data) => buildPickConsensus(data.tickets), false);
  }

  private async changeOpenPick(token: string | null, id: unknown, update: (ticket: StoredPick, event: LiveEvent, now: number) => void) {
    const tickets = await this.list(token);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new AccountError("invalid_input", "Supply a valid ticket id.");
    const snapshot = tickets.find(ticket => ticket.id === id);
    if (!snapshot) throw new AccountError("ticket_unavailable", "This ticket is unavailable.", 409);
    if (snapshot.status !== "open" || Date.parse(snapshot.startsAt) <= this.now()) {
      throw new AccountError("event_locked", "This ticket is already locked.", 409);
    }
    const event = await this.fetchEvent(snapshot.league, snapshot.eventId);
    return this.store.transaction(data => {
      const user = this.store.requireUser(data, token);
      const ticket = data.tickets.find(entry => entry.id === id && entry.userId === user.id);
      if (!ticket) throw new AccountError("ticket_unavailable", "This ticket is unavailable.", 409);
      const now = this.now();
      if (ticket.status !== "open" || Date.parse(ticket.startsAt) <= now) {
        throw new AccountError("event_locked", "This ticket is already locked.", 409);
      }
      if (!event || event.id !== ticket.eventId || event.league !== ticket.league || !validParticipants(event) ||
          event.home.id !== ticket.homeId || event.away.id !== ticket.awayId) {
        throw new AccountError("event_unavailable", "The event cannot be safely verified.", 409);
      }
      assertScheduled(event, now);
      update(ticket, event, now);
      return publicTicket(ticket);
    });
  }

  async cancel(token: string | null, id: unknown): Promise<RealPickTicket> {
    return this.changeOpenPick(token, id, (ticket, _event, now) => {
      ticket.status = "cancelled";
      ticket.settledAt = new Date(now).toISOString();
    });
  }

  async edit(token: string | null, input: Record<string, unknown>): Promise<RealPickTicket> {
    const {id, side, revision} = input;
    if ((side !== "home" && side !== "away" && side !== "draw") || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      throw new AccountError("invalid_input", "Supply a supported outcome and current revision.");
    }
    return this.changeOpenPick(token, id, (ticket, event, now) => {
      if (side === "draw" && !supportsDrawPick(ticket.league)) {
        throw new AccountError("invalid_input", "Draw picks are unavailable for this league.");
      }
      const changes = ticket.changes ?? [];
      if (changes.length !== revision) {
        throw new AccountError("pick_changed", "This pick changed. Close this dialog and refresh My picks to see the current selection.", 409);
      }
      if (ticket.side !== side) {
        ticket.changes = [...changes, {side: ticket.side, selection: ticket.selection, changedAt: new Date(now).toISOString()}];
        ticket.side = side;
        ticket.selection = pickName(event, side);
      }
    });
  }

  async refresh(token: string | null): Promise<RealPickTicket[]> {
    const tickets = (await this.list(token)).filter((ticket) => ticket.status === "open");
    const results = new Map<string, LiveEvent | null>();
    // Bound upstream concurrency; gather before the atomic write so a fetch failure cannot partially grade.
    for (let offset = 0; offset < tickets.length; offset += 4) {
      await Promise.all(tickets.slice(offset, offset + 4).map(async (ticket) => {
        results.set(ticket.id, await this.fetchEvent(ticket.league, ticket.eventId));
      }));
    }
    return this.store.transaction((data) => {
      const user = this.store.requireUser(data, token);
      for (const ticket of data.tickets) {
        if (ticket.userId !== user.id || ticket.status !== "open") continue;
        const event = results.get(ticket.id);
        if (!event || event.id !== ticket.eventId || event.league !== ticket.league || !validParticipants(event)
          || event.home.id !== ticket.homeId || event.away.id !== ticket.awayId) continue;
        if (event.status === "cancelled") ticket.status = "void";
        else if (event.status === "final" && event.completed === true && ["home", "away", "draw"].includes(event.winner ?? "")) {
          ticket.status = ticket.side === event.winner ? "won" : "lost";
        }
        if (ticket.status !== "open") ticket.settledAt = new Date(this.now()).toISOString();
      }
      return data.tickets.filter((ticket) => ticket.userId === user.id).map(publicTicket).reverse();
    });
  }

  async submit(token: string | null, input: unknown): Promise<RealPickTicket> {
    await this.list(token);
    const [ticket] = await this.savePicks(token, [validatePick(input)]);
    return ticket;
  }

  async submitBatch(token: string | null, input: unknown): Promise<RealPickTicket[]> {
    await this.list(token);
    if (!Array.isArray(input) || input.length < 2 || input.length > 5) {
      throw new AccountError("invalid_input", "Review between two and five picks.");
    }
    return this.savePicks(token, input.map(validatePick));
  }

  private async savePicks(token: string | null, picks: PickInput[]): Promise<RealPickTicket[]> {
    const requestIds = new Set(picks.map(pick => pick.requestId));
    const eventKeys = new Set(picks.map(pick => `${pick.league}:${pick.eventId}`));
    if (requestIds.size !== picks.length || eventKeys.size !== picks.length) {
      throw new AccountError("invalid_input", "Supply one selection per game and distinct request IDs.");
    }
    const events = await Promise.all(picks.map(async pick => {
      const event = await this.fetchEvent(pick.league, pick.eventId);
      if (!event || event.id !== pick.eventId || event.league !== pick.league) {
        throw new AccountError("event_unavailable", "A selected event is unavailable. No picks were saved.", 409);
      }
      return event;
    }));
    return this.store.transaction(data => {
      const user = this.store.requireUser(data, token);
      const now = this.now();
      const existing = data.tickets.filter(ticket => ticket.userId === user.id);
      // An identical batch can be retried after an interrupted response.
      if (picks.length > 1) {
        const previous = picks.map(pick => existing.find(ticket =>
          ticket.requestId === pick.requestId && ticket.league === pick.league &&
          ticket.eventId === pick.eventId && (ticket.changes?.[0]?.side ?? ticket.side) === pick.side));
        if (previous.every(ticket => ticket !== undefined)) return previous.map(publicTicket);
      }
      const entryId = picks.length > 1 ? randomUUID() : undefined;
      const tickets: StoredPick[] = picks.map(({eventId, league, side, requestId}, index) => {
        const event = events[index];
        assertScheduled(event, now);
        if (existing.some(ticket => ticket.requestId === requestId)) {
          throw new AccountError("request_replayed", "This request was already submitted. Review your existing tickets.", 409);
        }
        if (existing.some(ticket => ticket.eventId === eventId && ticket.league === league)) {
          throw new AccountError("duplicate_pick", "You already submitted a pick for a selected event.", 409);
        }
        return {
          id: randomUUID(), eventId, league, eventName: event.name, selection: pickName(event, side), side,
          startsAt: event.startsAt, createdAt: new Date(now).toISOString(), status: "open", settledAt: null,
          userId: user.id, requestId, homeId: event.home.id, awayId: event.away.id,
          ...(entryId ? {entryId, entryIndex: index, entrySize: picks.length} : {}),
        };
      });
      data.tickets.push(...tickets);
      return tickets.map(publicTicket);
    });
  }
}
