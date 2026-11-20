import { randomUUID } from "node:crypto";
import { AccountError, type StoredPick } from "./account-store";
import type { AccountBackend } from "./store-backend";
import { LIVE_LEAGUES, type LiveEvent } from "./live-sports";
import { pickName, supportsDrawPick, type PickSide } from "./pick-outcomes";
import type { PickConsensus } from "./pick-consensus";

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
  private readonly store: AccountBackend;
  private readonly getEvent: EventGetter;
  private readonly now: () => number;
  constructor(options: { store: AccountBackend; getEvent: EventGetter; now?: () => number }) {
    this.store = options.store; this.getEvent = options.getEvent; this.now = options.now ?? Date.now;
  }

  private async fetchEvent(league: string, id: string) {
    try { return await this.getEvent(league, id); }
    catch { throw new AccountError("feed_unavailable", "The real event provider is unavailable. No pick changes were made.", 409); }
  }

  async list(token: string | null): Promise<RealPickTicket[]> {
    return (await this.store.listPicks(token)).map(publicTicket).reverse();
  }

  // Public, anonymous aggregate: counts only, never user identities, and only
  // once enough pickers make the percentages non-identifying.
  async consensus(): Promise<PickConsensus> {
    return this.store.consensus();
  }

  private async changeOpenPick(token: string | null, id: unknown, update: (ticket: StoredPick, event: LiveEvent, now: number) => { action: "cancel" | "edit"; side: string | null; selection: string | null; revision: number | null }) {
    const tickets = await this.store.listPicks(token);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new AccountError("invalid_input", "Supply a valid ticket id.");
    const snapshot = tickets.find(ticket => ticket.id === id);
    if (!snapshot) throw new AccountError("ticket_unavailable", "This ticket is unavailable.", 409);
    if (snapshot.status !== "open" || Date.parse(snapshot.startsAt) <= this.now()) {
      throw new AccountError("event_locked", "This ticket is already locked.", 409);
    }
    const event = await this.fetchEvent(snapshot.league, snapshot.eventId);
    const now = this.now();
    if (!event || event.id !== snapshot.eventId || event.league !== snapshot.league || !validParticipants(event)
      || event.home.id !== snapshot.homeId || event.away.id !== snapshot.awayId) {
      throw new AccountError("event_unavailable", "The event cannot be safely verified.", 409);
    }
    assertScheduled(event, now);
    const change = update(snapshot, event, now);
    const saved = await this.store.changePick(token, id, change.action, change.side, change.selection, change.revision, now);
    return publicTicket(saved);
  }

  async cancel(token: string | null, id: unknown): Promise<RealPickTicket> {
    return this.changeOpenPick(token, id, () => ({ action: "cancel", side: null, selection: null, revision: null }));
  }

  async edit(token: string | null, input: Record<string, unknown>): Promise<RealPickTicket> {
    const {id, side, revision} = input;
    if ((side !== "home" && side !== "away" && side !== "draw") || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      throw new AccountError("invalid_input", "Supply a supported outcome and current revision.");
    }
    return this.changeOpenPick(token, id, (ticket, event) => {
      if (side === "draw" && !supportsDrawPick(ticket.league)) {
        throw new AccountError("invalid_input", "Draw picks are unavailable for this league.");
      }
      const changes = ticket.changes ?? [];
      if (changes.length !== revision) {
        throw new AccountError("pick_changed", "This pick changed. Close this dialog and refresh My picks to see the current selection.", 409);
      }
      return { action: "edit", side, selection: pickName(event, side), revision };
    });
  }

  async refresh(token: string | null): Promise<RealPickTicket[]> {
    const tickets = (await this.list(token)).filter((ticket) => ticket.status === "open");
    const stored = await this.store.listPicks(token);
    const byId = new Map(stored.map(ticket => [ticket.id, ticket]));
    const results = new Map<string, LiveEvent | null>();
    // Bound upstream concurrency; gather before the atomic write so a fetch failure cannot partially grade.
    for (let offset = 0; offset < tickets.length; offset += 4) {
      await Promise.all(tickets.slice(offset, offset + 4).map(async (ticket) => {
        results.set(ticket.id, await this.fetchEvent(ticket.league, ticket.eventId));
      }));
    }
    const settledAt = new Date(this.now()).toISOString();
    const updates = tickets.flatMap((ticket) => {
      const event = results.get(ticket.id);
      const storedTicket = byId.get(ticket.id);
      if (!event || !storedTicket || event.id !== ticket.eventId || event.league !== ticket.league || !validParticipants(event)
        || event.home.id !== storedTicket.homeId || event.away.id !== storedTicket.awayId) return [];
      let status: StoredPick["status"] | null = null;
      if (event.status === "cancelled") status = "void";
      else if (event.status === "final" && event.completed === true && ["home", "away", "draw"].includes(event.winner ?? "")) {
        status = ticket.side === event.winner ? "won" : "lost";
      }
      return status ? [{ id: ticket.id, status, settledAt }] : [];
    });
    if (updates.length) await this.store.settlePicks(token, updates);
    return this.list(token);
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
    const user = await this.store.getUser(token);
    if (!user) throw new AccountError("unauthorized", "Sign in to manage your free picks.", 401);
    const existing = await this.store.listPicks(token);
    const now = this.now();
    const entryId = picks.length > 1 ? randomUUID() : undefined;
    const tickets: StoredPick[] = picks.map(({eventId, league, side, requestId}, index) => {
      const event = events[index];
      assertScheduled(event, now);
      return {
        id: randomUUID(), eventId, league, eventName: event.name, selection: pickName(event, side), side,
        startsAt: event.startsAt, createdAt: new Date(now).toISOString(), status: "open", settledAt: null,
        userId: user.id, requestId, homeId: event.home.id, awayId: event.away.id,
        ...(entryId ? {entryId, entryIndex: index, entrySize: picks.length} : {}),
      };
    });
    // The backend performs the atomic replay/duplicate checks inside its write.
    return (await this.store.savePicks(token, tickets)).map(publicTicket);
  }
}
