import { randomUUID } from "node:crypto";
import { AccountError, type StoredPick } from "./account-store";
import type { AccountBackend } from "./store-backend";
import { LIVE_LEAGUES, type LiveEvent } from "./live-sports";
import { pickName, pickSides, supportsDrawPick, type PickMarket, type PickSide } from "./pick-outcomes";
import type { PickConsensus } from "./pick-consensus";

export type ChangeRequest = { action: "cancel" | "edit"; side: string | null; selection: string | null; revision: number | null; line?: number | null };
type PickChange = {
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
  market?: PickMarket;
  line?: number | null;
  changes?: PickChange[];
  /** Present for a multi-game free-picks entry; legacy tickets omit it. */
  entryId?: string;
  entryIndex?: number;
  entrySize?: number;
};
export type EventGetter = (league: string, id: string) => Promise<LiveEvent | null>;
export function publicTicket(ticket: StoredPick): RealPickTicket {
  const { id, eventId, league, eventName, selection, side, startsAt, createdAt, status, settledAt, market, line, changes, entryId, entryIndex, entrySize } = ticket;
  return {
    id, eventId, league, eventName, selection, side, startsAt, createdAt, status, settledAt,
    ...(market && market !== "moneyline" ? {market} : {}), ...(line !== null && line !== undefined ? {line} : {}),
    ...(changes ? {changes} : {}),
    ...(entryId ? {entryId, entryIndex, entrySize} : {}),
  };
}

type PickInput = { eventId: string; league: string; side: PickSide; requestId: string; market: PickMarket; line: number | null };
const PICK_MARKETS: readonly PickMarket[] = ["moneyline", "spread", "total"];
const isPickSide = (value: unknown): value is PickSide =>
  value === "home" || value === "away" || value === "draw" || value === "over" || value === "under";
function validatePick(input: unknown): PickInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AccountError("invalid_input", "Supply an event, league, supported outcome and unique requestId.");
  const value = input as Record<string, unknown>;
  const market = value.market === undefined ? "moneyline" : value.market;
  const line = value.line === undefined || value.line === null ? null : value.line;
  const sides = typeof value.league === "string" ? pickSides(value.league, market as PickMarket) : [];
  if (Object.keys(value).some((field) => !["eventId", "league", "side", "requestId", "market", "line"].includes(field))
    || typeof value.eventId !== "string" || !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(value.eventId)
    || typeof value.league !== "string" || !LIVE_LEAGUES.some((league) => league.id === value.league && league.sport !== "golf")
    || typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.requestId)
    || !PICK_MARKETS.includes(market as PickMarket) || !isPickSide(value.side) || !sides.includes(value.side)
    || (market === "moneyline" && value.side === "draw" && !supportsDrawPick(value.league as string))
    || (market === "moneyline" && line !== null)
    || (market !== "moneyline" && line !== null && (typeof line !== "number" || !Number.isFinite(line)
      || (market === "spread" && (line < -200 || line > 200))
      || (market === "total" && (line <= 0 || line > 2000))))) {
    throw new AccountError("invalid_input", "Supply an event, league, supported market, outcome and 8–128 character unique requestId.");
  }
  return { ...(value as PickInput), market: market as PickMarket, line: line as number | null };
}

// Lines come from the posted board: the home spread is stored signed, so the
// away side always receives the inverse. Totals share one posted number.
function marketLine(event: LiveEvent, input: PickInput): number | null {
  const odds = event.odds;
  if (input.market === "spread") {
    const spread = odds?.spread;
    if (spread === null || spread === undefined) return null;
    return input.side === "home" ? spread : -spread;
  }
  if (input.market === "total") {
    const total = odds?.total;
    return total === null || total === undefined ? null : total;
  }
  return null;
}

// Differential > 0 wins, < 0 loses, 0 pushes (void). Spread uses the chosen
// side's team margin plus its signed line; totals compare the posted number.
function marketResult(ticket: StoredPick, event: LiveEvent): "won" | "lost" | "void" | null {
  const homeScore = event.home.score, awayScore = event.away.score;
  if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) return null;
  const market = ticket.market ?? "moneyline";
  if (market === "moneyline") return null;
  const line = ticket.line;
  if (line === null || line === undefined) return null;
  let differential: number;
  if (market === "spread") {
    const margin = ticket.side === "home" ? homeScore - awayScore : awayScore - homeScore;
    differential = margin + line;
  } else {
    const sum = homeScore + awayScore;
    differential = ticket.side === "over" ? sum - line : line - sum;
  }
  return differential > 0 ? "won" : differential < 0 ? "lost" : "void";
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

  private async changeOpenPick(token: string | null, id: unknown, update: (ticket: StoredPick, event: LiveEvent, now: number) => ChangeRequest) {
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
    const saved = await this.store.changePick(token, id, change.action, change.side, change.selection, change.revision, now, change.line);
    return publicTicket(saved);
  }

  async cancel(token: string | null, id: unknown): Promise<RealPickTicket> {
    return this.changeOpenPick(token, id, () => ({ action: "cancel", side: null, selection: null, revision: null }));
  }

  async edit(token: string | null, input: Record<string, unknown>): Promise<RealPickTicket> {
    const {id, side, revision} = input;
    if (!isPickSide(side) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      throw new AccountError("invalid_input", "Supply a supported outcome and current revision.");
    }
    return this.changeOpenPick(token, id, (ticket, event) => {
      const market = ticket.market ?? "moneyline";
      if (!pickSides(ticket.league, market).includes(side)) {
        throw new AccountError("invalid_input", "That outcome is unavailable for this pick's market.");
      }
      const changes = ticket.changes ?? [];
      if (changes.length !== revision) {
        throw new AccountError("pick_changed", "This pick changed. Close this dialog and refresh My picks to see the current selection.", 409);
      }
      // A spread flip swaps which team lays the points, so the stored line
      // negates; totals keep the same posted number across over/under.
      const flipped = market === "spread" && ticket.side !== side;
      const nextLine = ticket.line === null || ticket.line === undefined ? ticket.line
        : flipped ? -ticket.line : ticket.line;
      return { action: "edit", side, selection: pickName(event, side, "name", market, nextLine ?? null), revision, line: nextLine };
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
      else if (event.status === "final" && event.completed === true) {
        if (["home", "away", "draw"].includes(event.winner ?? "")) {
          status = (ticket.market ?? "moneyline") === "moneyline"
            ? (ticket.side === event.winner ? "won" : "lost")
            : marketResult(storedTicket, event);
        }
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
    const eventKeys = new Set(picks.map(pick => `${pick.league}:${pick.eventId}:${pick.market}`));
    if (requestIds.size !== picks.length || eventKeys.size !== picks.length) {
      throw new AccountError("invalid_input", "Supply one selection per game and market and distinct request IDs.");
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
    const tickets: StoredPick[] = picks.map(({eventId, league, side, requestId, market, line}, index) => {
      const event = events[index];
      assertScheduled(event, now);
      const posted = marketLine(event, { eventId, league, side, requestId, market, line });
      if (market !== "moneyline" && posted === null) {
        throw new AccountError("event_unavailable", "This market is not posted for the selected event. No picks were saved.", 409);
      }
      const effectiveLine = market === "moneyline" ? null : posted;
      return {
        id: randomUUID(), eventId, league, eventName: event.name,
        selection: pickName(event, side, "name", market, effectiveLine), side,
        market, line: effectiveLine,
        startsAt: event.startsAt, createdAt: new Date(now).toISOString(), status: "open", settledAt: null,
        userId: user.id, requestId, homeId: event.home.id, awayId: event.away.id,
        ...(entryId ? {entryId, entryIndex: index, entrySize: picks.length} : {}),
      };
    });
    // The backend performs the atomic replay/duplicate checks inside its write.
    return (await this.store.savePicks(token, tickets)).map(publicTicket);
  }
}
