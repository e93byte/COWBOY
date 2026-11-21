import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RealPickTicket } from "./pick-service";
import { followKey, isFollowPreference, type FollowPreference } from "./follow-preferences";
import { buildPickConsensus, type PickConsensus } from "./pick-consensus";
import { buildPublicPickLeaderboard, type PublicLeaderboardEntry } from "./pick-leaderboard";
import type { ParlayLeg } from "./parlay";
import type { PropSelection } from "./pick-outcomes";

const scrypt = promisify(scryptCallback);
export type AccountUser = { id: string; username: string; email?: string | null; emailVerified?: boolean; leaderboardOptIn?: boolean; tokens?: number; referralCode?: string };
type StoredUser = AccountUser & { salt: string; passwordHash: string; follows?: FollowPreference[]; emailVerifiedAt?: number; referredBy?: string };
type StoredSession = { hash: string; userId: string; expiresAt: number };
type StoredToken = { hash: string; userId: string; purpose: "verify_email" | "password_reset"; expiresAt: number; consumedAt?: number };
export type StoredPick = RealPickTicket & { userId: string; requestId: string; homeId: string; awayId: string };
export type StoredParlay = {
  id: string;
  legs: ParlayLeg[];
  entryId: string;
  userId: string;
  createdAt: string;
  status: "open" | "won" | "lost" | "void" | "cancelled";
  settledAt: string | null;
  combinedOdds: number;
  chipStake?: number;
};
export type Contest = { id: string; title: string; kind: 'daily' | 'weekly' | 'seasonal'; startsAt: string; endsAt: string; league: string | null; status: 'upcoming' | 'active' | 'settled'; createdAt: string };
export type ContestStanding = { rank: number; username: string; decidedEvents: number; wins: number; accuracy: number };
export type TokenLedgerEntry = { amount: number; reason: string; at: string; userId?: string; awardKey?: string };
export type StoreData = { version: 1; users: StoredUser[]; sessions: StoredSession[]; tickets: StoredPick[]; parlays: StoredParlay[]; contests: Contest[]; contestEntries: Array<{userId:string;contestId:string;joinedAt:string}>; tokenLedger: TokenLedgerEntry[]; tokens?: StoredToken[] };
export type StoreOptions = { directory?: string; now?: () => number };
const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_MAX_AGE = SESSION_SECONDS;
const globals = globalThis as typeof globalThis & { cowboyStoreQueues?: Map<string, Promise<unknown>> };
const queues = globals.cowboyStoreQueues ??= new Map();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export class AccountError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 401 | 404 | 409 = 400) { super(message); }
}

function validateStore(data: StoreData): void {
  const fail = () => { throw new Error("Invalid local account data"); };
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const hex = (value: unknown, length: number) => typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value);
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (data?.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.sessions) || !Array.isArray(data.tickets)) fail();
  const userIds = new Set<string>();
  const usernames = new Set<string>();
  for (const user of data.users) {
    if (!user || !nonempty(user.id) || typeof user.username !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{2,29}$/.test(user.username)
      || !hex(user.salt, 32) || !hex(user.passwordHash, 128) || userIds.has(user.id) || usernames.has(user.username.toLowerCase())) fail();
    if (user.email !== undefined && user.email !== null &&
        (typeof user.email !== "string" || user.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user.email))) fail();
    if (user.emailVerifiedAt !== undefined && !Number.isSafeInteger(user.emailVerifiedAt)) fail();
    if (user.leaderboardOptIn !== undefined && typeof user.leaderboardOptIn !== "boolean") fail();
    if (user.tokens !== undefined && (typeof user.tokens !== "number" || !Number.isSafeInteger(user.tokens) || user.tokens < 0)) fail();
    if (user.referralCode !== undefined && (typeof user.referralCode !== "string" || !/^[a-z0-9]{8}$/.test(user.referralCode))) fail();
    if (user.follows !== undefined && (!Array.isArray(user.follows) ||
        !user.follows.every(isFollowPreference) ||
        new Set(user.follows.map(followKey)).size !== user.follows.length)) fail();
    userIds.add(user.id); usernames.add(user.username.toLowerCase());
  }
  const sessions = new Set<string>();
  for (const session of data.sessions) {
    if (!session || !hex(session.hash, 64) || !userIds.has(session.userId) || !Number.isSafeInteger(session.expiresAt)
      || session.expiresAt < 0 || sessions.has(session.hash)) fail();
    sessions.add(session.hash);
  }
  const tickets = new Set<string>();
  const requests = new Set<string>();
  const events = new Set<string>();
  for (const ticket of data.tickets) {
    if (!ticket || !nonempty(ticket.id) || !userIds.has(ticket.userId) || !nonempty(ticket.requestId)
      || !nonempty(ticket.eventId) || !nonempty(ticket.league) || !nonempty(ticket.homeId) || !nonempty(ticket.awayId)
      || ticket.homeId === ticket.awayId || !nonempty(ticket.eventName) || !nonempty(ticket.selection)
      || !["home", "away", "draw", "over", "under"].includes(ticket.side) || !["open", "won", "lost", "void", "cancelled"].includes(ticket.status)
      || (ticket.market !== undefined && !["moneyline", "spread", "total", "prop"].includes(ticket.market))
      || (ticket.live !== undefined && typeof ticket.live !== "boolean")
      || (ticket.odds !== undefined && ticket.odds !== null && !Number.isFinite(ticket.odds))
      || (ticket.prop !== undefined && (!ticket.prop || typeof ticket.prop.player !== "string"
        || !ticket.prop.player.trim() || typeof ticket.prop.stat !== "string" || !ticket.prop.stat.trim()
        || typeof ticket.prop.book !== "string" || !Number.isFinite(ticket.prop.line)))
      || (ticket.market === "prop" && ticket.prop === undefined)
      || (ticket.line !== undefined && ticket.line !== null && !Number.isFinite(ticket.line))
      || !date(ticket.startsAt) || !date(ticket.createdAt)
      || (ticket.status === "open" ? ticket.settledAt !== null : !date(ticket.settledAt))) fail();
    if (ticket.changes !== undefined && (!Array.isArray(ticket.changes) || ticket.changes.some(change =>
      !change || !["home", "away", "draw", "over", "under"].includes(change.side) || !nonempty(change.selection) || !date(change.changedAt)))) fail();
    const hasEntryMetadata = ticket.entryId !== undefined || ticket.entryIndex !== undefined || ticket.entrySize !== undefined;
    const entryId = ticket.entryId;
    const entryIndex = ticket.entryIndex;
    const entrySize = ticket.entrySize;
    const entryIndexValue = typeof entryIndex === "number" ? entryIndex : -1;
    const entrySizeValue = typeof entrySize === "number" ? entrySize : -1;
    const validEntryIndex = Number.isSafeInteger(entryIndexValue) && entryIndexValue >= 0;
    const validEntrySize = Number.isSafeInteger(entrySizeValue) && entrySizeValue >= 2 && entrySizeValue <= 5;
    if (hasEntryMetadata && (typeof entryId !== "string" || !/^[a-f0-9-]{36}$/.test(entryId)
      || !validEntryIndex || !validEntrySize || entryIndexValue >= entrySizeValue)) fail();
    const request = JSON.stringify([ticket.userId, ticket.requestId]);
    const event = JSON.stringify([ticket.userId, ticket.league, ticket.eventId, ticket.market ?? "moneyline"]);
    if (tickets.has(ticket.id) || requests.has(request) || events.has(event)) fail();
    tickets.add(ticket.id); requests.add(request); events.add(event);
  }
  const tokenHashes = new Set<string>();
  for (const token of data.tokens ?? []) {
    if (!token || !hex(token.hash, 64) || !userIds.has(token.userId)
      || !["verify_email", "password_reset"].includes(token.purpose)
      || !Number.isSafeInteger(token.expiresAt) || tokenHashes.has(token.hash)) fail();
    if (token.consumedAt !== undefined && !Number.isSafeInteger(token.consumedAt)) fail();
    tokenHashes.add(token.hash);
  }
  const contestIds = new Set(data.contests.map(c => c.id));
  for (const contest of data.contests) {
    if (!contest || typeof contest.id !== "string" || !contest.id.trim()
      || typeof contest.title !== "string" || !contest.title.trim()
      || !["daily","weekly","seasonal"].includes(contest.kind)
      || !date(contest.startsAt) || !date(contest.endsAt)
      || Date.parse(contest.endsAt) <= Date.parse(contest.startsAt)
      || !["upcoming","active","settled"].includes(contest.status)
      || contest.league !== null && typeof contest.league !== "string"
      || !date(contest.createdAt) || contestIds.has(contest.id) && data.contests.filter(c=>c.id===contest.id).length > 1) fail();
  }
  const entryKeys = new Set<string>();
  for (const entry of data.contestEntries ?? []) {
    if (!entry || typeof entry.userId !== "string" || !userIds.has(entry.userId)
      || typeof entry.contestId !== "string" || !contestIds.has(entry.contestId)
      || !date(entry.joinedAt)) fail();
    const key = `${entry.userId}:${entry.contestId}`;
    if (entryKeys.has(key)) fail();
    entryKeys.add(key);
  }
  const ledgerKeys = new Set<string>();
  const awardKeys = new Set<string>();
  for (const entry of data.tokenLedger ?? []) {
    if (!entry || typeof entry.amount !== "number" || !Number.isSafeInteger(entry.amount)
      || typeof entry.reason !== "string" || !entry.reason.trim() || !date(entry.at)
      || (entry.userId !== undefined && !userIds.has(entry.userId))
      || (entry.awardKey !== undefined && (typeof entry.awardKey !== "string" || !/^[a-z][a-z0-9_:-]{2,160}$/.test(entry.awardKey)))) fail();
    const k = `${entry.userId ?? ""}:${entry.at}:${entry.reason}:${entry.amount}`;
    if (ledgerKeys.has(k)) fail();
    ledgerKeys.add(k);
    if (entry.awardKey) {
      const award = `${entry.userId ?? ""}:${entry.awardKey}`;
      if (awardKeys.has(award)) fail();
      awardKeys.add(award);
    }
  }
}

function validateCredentials(username: unknown, password: unknown): asserts username is string {
  if (typeof username !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{2,29}$/.test(username)
    || typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new AccountError("invalid_input", "Use a 3–30 character username (letters, digits, _ or -) and a 10–128 character password.");
  }
}

async function canonicalDirectory(directory: string): Promise<string> {
  try { return await realpath(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return path.join(await canonicalDirectory(path.dirname(directory)), path.basename(directory));
  }
}

export class AccountStore {
  readonly directory: string;
  readonly now: () => number;
  constructor(options: StoreOptions = {}) {
    this.directory = path.resolve(options.directory ?? process.env.COWBOY_DATA_DIR ?? ".cowboy-data");
    this.now = options.now ?? Date.now;
  }

  async transaction<T>(operation: (data: StoreData) => Promise<T> | T, write = true): Promise<T> {
    const directory = await canonicalDirectory(this.directory);
    const publicDirectory = await canonicalDirectory(path.resolve("public"));
    if (this.directory.split(path.sep).includes("public") || directory.split(path.sep).includes("public")
      || directory === publicDirectory || directory.startsWith(publicDirectory + path.sep)) {
      throw new AccountError("unsafe_storage", "Local account storage must be outside public directories.");
    }
    const previous = queues.get(directory) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, "store.json");
      let data: StoreData;
      try {
        const metadata = await lstat(file);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new AccountError("unsafe_storage", "Account storage must be a regular file, not a symbolic link.");
        }
        data = JSON.parse(await readFile(file, "utf8")) as StoreData;
        validateStore(data);
        if ((metadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
          throw new AccountError("unsafe_storage", "Account storage must be an owner-only regular file (mode 600).");
        }
      } catch (error) {
        if (error instanceof AccountError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new AccountError("storage_unavailable", "Local account storage cannot be read safely.", 409);
        }
        data = { version: 1, users: [], sessions: [], tickets: [], parlays: [], contests: [] as Contest[], contestEntries: [] as Array<{userId:string;contestId:string;joinedAt:string}>, tokenLedger: [] };
      }
      const result = await operation(data);
      if (write) {
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, "wx", 0o600);
          try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
          finally { await handle.close(); }
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
      }
      return result;
    });
    queues.set(directory, current);
    try { return await current; }
    finally { if (queues.get(directory) === current) queues.delete(directory); }
  }

  async register(username: string, password: string) {
    validateCredentials(username, password);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
    return this.transaction((data) => {
      if (data.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
        throw new AccountError("username_taken", "That username is already registered.", 409);
      }
      const user = { id: randomUUID(), username };
      const referralCode = randomBytes(4).toString("hex");
      data.users.push({ ...user, salt, passwordHash, tokens: 5000, referralCode });
      data.tokenLedger.push({ userId: user.id, amount: 5000, reason: 'signup_bonus', awardKey: 'signup_bonus', at: new Date(this.now()).toISOString() });
      return this.createSession(data, user);
    });
  }

  async login(username: string, password: string) {
    validateCredentials(username, password);
    return this.transaction(async (data) => {
      const user = data.users.find((entry) => entry.username.toLowerCase() === username.toLowerCase());
      // Perform the same expensive hash even for a missing username.
      const hash = await scrypt(password, user?.salt ?? "00000000000000000000000000000000", 64) as Buffer;
      if (!user || !timingSafeEqual(hash, Buffer.from(user.passwordHash, "hex"))) {
        throw new AccountError("invalid_credentials", "Username or password is incorrect.", 401);
      }
      return this.createSession(data, user);
    });
  }

  async deleteAccount(token: string | null, password: string) {
    await this.transaction(async data => {
      const owner = this.requireUser(data,token);
      const user = data.users.find(record=>record.id===owner.id)!;
      validateCredentials(user.username,password);
      const hash = await scrypt(password,user.salt,64) as Buffer;
      if (!timingSafeEqual(hash,Buffer.from(user.passwordHash,'hex'))) {
        throw new AccountError('invalid_credentials','Password is incorrect.',401);
      }
      this.requireUser(data,token);
      data.users = data.users.filter(record=>record.id!==owner.id);
      data.sessions = data.sessions.filter(session=>session.userId!==owner.id);
      data.tickets = data.tickets.filter(ticket=>ticket.userId!==owner.id);
      data.parlays = data.parlays.filter(parlay=>parlay.userId!==owner.id);
      data.contestEntries = data.contestEntries.filter(entry=>entry.userId!==owner.id);
      data.tokenLedger = (data.tokenLedger ?? []).filter(entry=>entry.userId!==owner.id);
      data.tokens = (data.tokens ?? []).filter(token=>token.userId!==owner.id);
    });
  }

  async revokeOtherSessions(token: string | null) {
    return this.transaction(data => {
      const user = this.requireUser(data,token);
      const current = digest(token!);
      const now = this.now();
      let revoked = 0;
      data.sessions = data.sessions.filter(session => {
        if (session.userId !== user.id || session.hash === current) return true;
        if (session.expiresAt > now) revoked++;
        return false;
      });
      return revoked;
    });
  }

  async logout(token: string | null | undefined) {
    if (!token) return;
    await this.transaction((data) => { data.sessions = data.sessions.filter((session) => session.hash !== digest(token)); });
  }

  private createSession(data: StoreData, user: AccountUser) {
    data.sessions = data.sessions.filter((session) => session.expiresAt > this.now());
    const token = randomBytes(32).toString("hex");
    data.sessions.push({ hash: digest(token), userId: user.id, expiresAt: this.now() + SESSION_SECONDS * 1000 });
    return { user: this.userInData(data, token)!, token };
  }

  userInData(data: StoreData, token: string | null | undefined): AccountUser | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = data.sessions.find((entry) => entry.hash === digest(token) && entry.expiresAt > this.now());
    const user = session && data.users.find((entry) => entry.id === session.userId);
    return user ? { id: user.id, username: user.username,
      ...(user.email ? { email: user.email, emailVerified: user.emailVerifiedAt !== undefined } : {}),
      ...(user.leaderboardOptIn ? {leaderboardOptIn:true} : {}),
      ...(user.tokens !== undefined ? { tokens: user.tokens } : {}),
      ...(user.referralCode ? { referralCode: user.referralCode } : {}) } : null;
  }

  requireUser(data: StoreData, token: string | null | undefined): AccountUser {
    const user = this.userInData(data, token);
    if (!user) throw new AccountError("unauthorized", "Sign in to manage your free picks.", 401);
    return user;
  }

  async getUser(token: string | null | undefined): Promise<AccountUser | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.transaction((data) => this.userInData(data, token), false);
  }

  // AccountBackend surface (store-backend.ts): pick/follow/export operations
  // expressed over the same serialized file transaction.
  async getFollows(token: string | null): Promise<FollowPreference[]> {
    return this.transaction((data) => {
      const { id } = this.requireUser(data, token);
      return data.users.find((user) => user.id === id)?.follows ?? [];
    }, false);
  }

  async setFollows(token: string | null, follows: FollowPreference[]): Promise<FollowPreference[]> {
    return this.transaction((data) => {
      const { id } = this.requireUser(data, token);
      const user = data.users.find((entry) => entry.id === id)!;
      user.follows = follows;
      return user.follows;
    });
  }

  async exportAccount(token: string | null) {
    return this.transaction((records) => {
      const account = this.requireUser(records, token);
      const stored = records.users.find((user) => user.id === account.id);
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        account,
        follows: stored?.follows ?? [],
        picks: records.tickets.filter((ticket) => ticket.userId === account.id).map((ticket) => ({
          id: ticket.id, eventId: ticket.eventId, league: ticket.league, eventName: ticket.eventName,
          selection: ticket.selection, side: ticket.side, startsAt: ticket.startsAt, createdAt: ticket.createdAt,
          status: ticket.status, settledAt: ticket.settledAt,
          ...(ticket.market && ticket.market !== "moneyline" ? { market: ticket.market } : {}),
          ...(ticket.line !== null && ticket.line !== undefined ? { line: ticket.line } : {}),
          ...(ticket.changes ? { changes: ticket.changes } : {}),
          ...(ticket.entryId ? { entryId: ticket.entryId, entryIndex: ticket.entryIndex, entrySize: ticket.entrySize } : {}),
        })),
      };
    }, false);
  }

  async listPicks(token: string | null): Promise<StoredPick[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      return data.tickets.filter((ticket) => ticket.userId === user.id);
    }, false);
  }

  async listParlays(token: string | null): Promise<StoredParlay[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      return data.parlays.filter((parlay) => parlay.userId === user.id);
    }, false);
  }

  async settleParlays(token: string | null, updates: Array<{ id: string; status: StoredParlay["status"]; settledAt: string }>): Promise<StoredParlay[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      for (const update of updates) {
        const parlay = data.parlays.find((entry) => entry.id === update.id && entry.userId === user.id);
        if (parlay && parlay.status === "open") {
          parlay.status = update.status;
          parlay.settledAt = update.settledAt;
        }
      }
      return data.parlays.filter((parlay) => parlay.userId === user.id);
    });
  }

  async listContests(): Promise<Contest[]> {
    return this.transaction((data) => {
      const today = new Date(this.now());
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
      const iso = (d: Date) => d.toISOString();
      if (!data.contests.some(c => c.kind === 'daily' && Date.parse(c.startsAt) >= start.getTime())) {
        data.contests.push({
          id: `daily-${iso(start).slice(0, 10)}`,
          title: 'Daily Free Pick Contest',
          kind: 'daily',
          startsAt: iso(start),
          endsAt: iso(end),
          league: null,
          status: 'active',
          createdAt: iso(new Date(this.now())),
        });
      }
      return [...data.contests].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
    }, true);
  }

  async joinContest(contestId: string, token: string | null): Promise<{ joined: boolean }> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      const contest = data.contests.find(c => c.id === contestId);
      if (!contest) throw new AccountError("not_found", "Contest not found.", 404);
      if (contest.status !== "upcoming") throw new AccountError("contest_locked", "This contest is no longer accepting entries.", 409);
      const already = data.contestEntries.some(e => e.userId === user.id && e.contestId === contestId);
      if (!already) {
        data.contestEntries.push({ userId: user.id, contestId, joinedAt: new Date(this.now()).toISOString() });
      }
      return { joined: true };
    });
  }

  async contestStandings(contestId: string): Promise<ContestStanding[]> {
    return this.transaction((data) => {
      const contest = data.contests.find(c => c.id === contestId);
      if (!contest) throw new AccountError("not_found", "Contest not found.", 404);
      const joined = new Set(data.contestEntries.filter(e => e.contestId === contestId).map(e => e.userId));
      const started = Date.parse(contest.startsAt);
      const ended = Date.parse(contest.endsAt);
      const league = contest.league;
      const perUser = new Map<string, { decided: number; wins: number }>();
      for (const ticket of data.tickets) {
        if (!joined.has(ticket.userId)) continue;
        if (ticket.status === "won" || ticket.status === "lost" || ticket.status === "void") {
          const created = Date.parse(ticket.createdAt);
          if (created < started || created > ended) continue;
          if (league !== null && ticket.league !== league) continue;
          const cur = perUser.get(ticket.userId) ?? { decided: 0, wins: 0 };
          if (ticket.status !== "void") cur.decided++;
          if (ticket.status === "won") cur.wins++;
          perUser.set(ticket.userId, cur);
        }
      }
      const qualified = [...perUser.entries()]
        .filter(([userId, stats]) => stats.decided >= 5)
        .map(([userId, stats]) => {
          const user = data.users.find(u => u.id === userId)!;
          return user.leaderboardOptIn ? { userId, username: user.username, decided: stats.decided, wins: stats.wins, accuracy: stats.wins / stats.decided } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => b.accuracy - a.accuracy || b.decided - a.decided || b.wins - a.wins || a.username.localeCompare(b.username));
      return qualified.map((entry, index) => ({
        rank: index + 1, username: entry.username, decidedEvents: entry.decided, wins: entry.wins, accuracy: entry.accuracy,
      }));
    }, false);
  }

  async getTokens(token: string | null): Promise<{ tokens: number; ledger: TokenLedgerEntry[] }> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      const ledger = (data.tokenLedger ?? []).filter(entry => entry.userId === user.id)
        .map(({ amount, reason, at, awardKey }) => ({ amount, reason, at, ...(awardKey ? { awardKey } : {}) }));
      return { tokens: user.tokens ?? 0, ledger };
    }, false);
  }

  async awardTokens(token: string | null, userId: string, amount: number, reason: string, awardKey: string): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || !/^[a-z][a-z0-9_:-]{2,160}$/.test(awardKey)) return;
    return this.transaction((data) => {
      const owner = this.requireUser(data, token);
      if (owner.id !== userId) throw new AccountError("unauthorized", "You cannot award tokens to another account.", 401);
      const user = data.users.find(u => u.id === owner.id)!;
      if (data.tokenLedger.some(entry => entry.userId === owner.id && entry.awardKey === awardKey)) return;
      user.tokens = (user.tokens ?? 0) + amount;
      data.tokenLedger.push({ userId: owner.id, amount, reason, awardKey, at: new Date(this.now()).toISOString() });
    }, true);
  }

  async adjustTokens(token: string | null, userId: string, amount: number, reason: string, awardKey: string): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount === 0 || !/^[a-z][a-z0-9_:-]{2,160}$/.test(reason) || !/^[a-z][a-z0-9_:-]{2,160}$/.test(awardKey)) return;
    return this.transaction((data) => {
      const owner = this.requireUser(data, token);
      if (owner.id !== userId) throw new AccountError("unauthorized", "You cannot adjust tokens on another account.", 401);
      const user = data.users.find(u => u.id === owner.id)!;
      if (data.tokenLedger.some(entry => entry.userId === owner.id && entry.awardKey === awardKey)) return;
      if ((user.tokens ?? 0) + amount < 0) throw new AccountError("insufficient_chips", "Not enough chips for that stake.", 409);
      user.tokens = (user.tokens ?? 0) + amount;
      data.tokenLedger.push({ userId: owner.id, amount, reason, awardKey, at: new Date(this.now()).toISOString() });
    }, true);
  }

  async consensus(): Promise<PickConsensus> {
    return this.transaction((data) => buildPickConsensus(data.tickets), false);
  }

  async publicLeaderboard(): Promise<PublicLeaderboardEntry[]> {
    return this.transaction(data => buildPublicPickLeaderboard(data.users, data.tickets), false);
  }

  async setLeaderboardOptIn(token: string | null, enabled: boolean): Promise<AccountUser> {
    if (typeof enabled !== "boolean") throw new AccountError("invalid_input", "Supply a valid leaderboard preference.");
    return this.transaction(data => {
      const owner = this.requireUser(data, token);
      const user = data.users.find(entry => entry.id === owner.id)!;
      user.leaderboardOptIn = enabled;
      return this.userInData(data, token)!;
    });
  }

  async savePicks(token: string | null, tickets: StoredPick[]): Promise<StoredPick[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      const existing = data.tickets.filter((ticket) => ticket.userId === user.id);
      // An identical batch can be retried after an interrupted response.
      if (tickets.length > 1) {
        const previous = tickets.map((ticket) => existing.find((entry) =>
          entry.requestId === ticket.requestId && entry.league === ticket.league &&
          entry.eventId === ticket.eventId && (entry.market ?? "moneyline") === (ticket.market ?? "moneyline") &&
          (entry.changes?.[0]?.side ?? entry.side) === ticket.side));
        if (previous.every((ticket) => ticket !== undefined)) return previous as StoredPick[];
      }
      const saved: StoredPick[] = [];
      for (const ticket of tickets) {
        if (existing.some((entry) => entry.requestId === ticket.requestId)) {
          throw new AccountError("request_replayed", "This request was already submitted. Review your existing tickets.", 409);
        }
        if (existing.some((entry) => entry.eventId === ticket.eventId && entry.league === ticket.league
          && (entry.market ?? "moneyline") === (ticket.market ?? "moneyline"))) {
          throw new AccountError("duplicate_pick", "You already submitted a pick for a selected event.", 409);
        }
        existing.push(ticket);
        saved.push(ticket);
      }
      data.tickets.push(...saved);
      return saved;
    });
  }

  async saveParlay(token: string | null, parlay: StoredParlay): Promise<StoredParlay[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      const existing = data.parlays.filter((p) => p.userId === user.id);
      if (existing.some((entry) => entry.id === parlay.id)) {
        throw new AccountError("duplicate_parlay", "This parlay already exists.", 409);
      }
      data.parlays.push(parlay);
      return [parlay];
    });
  }

  async changePick(token: string | null, id: string, action: "cancel" | "edit", side: string | null, selection: string | null, revision: number | null, now: number = this.now(), line?: number | null): Promise<StoredPick> {
    const stamp = new Date(now).toISOString();
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      const ticket = data.tickets.find((entry) => entry.id === id && entry.userId === user.id);
      if (!ticket) throw new AccountError("ticket_unavailable", "This ticket is unavailable.", 409);
      if (ticket.status !== "open" || Date.parse(ticket.startsAt) <= now) {
        throw new AccountError("event_locked", "This ticket is already locked.", 409);
      }
      if (action === "cancel") {
        ticket.status = "cancelled";
        ticket.settledAt = stamp;
      } else if (action === "edit" && side && selection) {
        const changes = ticket.changes ?? [];
        if (changes.length !== revision) {
          throw new AccountError("pick_changed", "This pick changed. Close this dialog and refresh My picks to see the current selection.", 409);
        }
        if (ticket.side !== side || (line !== undefined && line !== ticket.line)) {
          ticket.changes = [...changes, { side: ticket.side, selection: ticket.selection, changedAt: stamp }];
          ticket.side = side as StoredPick["side"];
          ticket.selection = selection;
          if (line !== undefined) ticket.line = line;
        }
      }
      return ticket;
    });
  }

  async settlePicks(token: string | null, updates: Array<{ id: string; status: StoredPick["status"]; settledAt: string }>): Promise<StoredPick[]> {
    return this.transaction((data) => {
      const user = this.requireUser(data, token);
      for (const update of updates) {
        const ticket = data.tickets.find((entry) => entry.id === update.id && entry.userId === user.id);
        if (ticket && ticket.status === "open") {
          ticket.status = update.status;
          ticket.settledAt = update.settledAt;
        }
      }
      return data.tickets.filter((ticket) => ticket.userId === user.id);
    });
  }

  // Email + password-reset surface (store-backend.ts). Raw tokens are returned
  // to the caller for emailing; only their SHA-256 digests are stored.
  private issueToken(data: StoreData, userId: string, purpose: StoredToken["purpose"], ttlSeconds: number) {
    const tokens = data.tokens ??= [];
    tokens.splice(0, tokens.length, ...tokens.filter((token) =>
      !(token.userId === userId && token.purpose === purpose && token.consumedAt === undefined)));
    const raw = randomBytes(32).toString("hex");
    tokens.push({ hash: digest(raw), userId, purpose, expiresAt: this.now() + ttlSeconds * 1000 });
    return raw;
  }

  private consumeToken(data: StoreData, rawToken: string, purpose: StoredToken["purpose"]): StoredToken | undefined {
    if (!/^[a-f0-9]{64}$/.test(rawToken)) return undefined;
    const hash = digest(rawToken);
    const token = (data.tokens ?? []).find((entry) => entry.hash === hash && entry.purpose === purpose
      && entry.consumedAt === undefined && entry.expiresAt > this.now());
    if (token) token.consumedAt = this.now();
    return token;
  }

  async setEmail(token: string | null, email: string) {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new AccountError("invalid_input", "Enter a valid email address.");
    }
    return this.transaction((data) => {
      const owner = this.requireUser(data, token);
      if (data.users.some((user) => user.id !== owner.id && user.email?.toLowerCase() === normalized)) {
        throw new AccountError("email_taken", "That email is already registered to another account.", 409);
      }
      const user = data.users.find((entry) => entry.id === owner.id)!;
      user.email = normalized;
      delete user.emailVerifiedAt;
      const verifyToken = this.issueToken(data, owner.id, "verify_email", 24 * 60 * 60);
      return { email: normalized, verifyToken };
    });
  }

  async verifyEmail(rawToken: string): Promise<boolean> {
    return this.transaction((data) => {
      const token = this.consumeToken(data, rawToken, "verify_email");
      if (!token) return false;
      const user = data.users.find((entry) => entry.id === token.userId);
      if (user?.email) user.emailVerifiedAt = this.now();
      return user?.email !== undefined;
    });
  }

  async requestPasswordReset(username: string) {
    if (typeof username !== "string" || username.length > 64) return null;
    return this.transaction((data) => {
      const user = data.users.find((entry) => entry.username.toLowerCase() === username.toLowerCase() && entry.email);
      if (!user?.email) return null;
      const resetToken = this.issueToken(data, user.id, "password_reset", 60 * 60);
      return { email: user.email, resetToken };
    });
  }

  async resetPassword(rawToken: string, password: string) {
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
      throw new AccountError("invalid_input", "Use a 10–128 character password.");
    }
    await this.transaction(async (data) => {
      const token = this.consumeToken(data, rawToken, "password_reset");
      const user = token && data.users.find((entry) => entry.id === token.userId);
      if (!token || !user) throw new AccountError("invalid_token", "This reset link is invalid or has expired.", 409);
      user.salt = randomBytes(16).toString("hex");
      user.passwordHash = (await scrypt(password, user.salt, 64) as Buffer).toString("hex");
      data.sessions = data.sessions.filter((session) => session.userId !== user.id);
    });
  }
}
