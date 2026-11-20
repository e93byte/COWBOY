import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RealPickTicket } from "./pick-service";
import { followKey, isFollowPreference, type FollowPreference } from "./follow-preferences";
import { buildPickConsensus, type PickConsensus } from "./pick-consensus";

const scrypt = promisify(scryptCallback);
export type AccountUser = { id: string; username: string; email?: string | null; emailVerified?: boolean };
type StoredUser = AccountUser & { salt: string; passwordHash: string; follows?: FollowPreference[]; emailVerifiedAt?: number };
type StoredSession = { hash: string; userId: string; expiresAt: number };
type StoredToken = { hash: string; userId: string; purpose: "verify_email" | "password_reset"; expiresAt: number; consumedAt?: number };
export type StoredPick = RealPickTicket & { userId: string; requestId: string; homeId: string; awayId: string };
export type StoreData = { version: 1; users: StoredUser[]; sessions: StoredSession[]; tickets: StoredPick[]; tokens?: StoredToken[] };
export type StoreOptions = { directory?: string; now?: () => number };
const SESSION_SECONDS = 60 * 60 * 24 * 7;
/** Supabase project configuration.
 * The connected Supabase project ID is: ca_lBY496gOPMFZ
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env vars
 * to override the defaults.
 */
export const supabaseUrl = 'https://ca_lBY496gOPMFZ.supabase.co';
export const supabaseAnonKey = '';
export const SESSION_MAX_AGE = SESSION_SECONDS;
const globals = globalThis as typeof globalThis & { cowboyStoreQueues?: Map<string, Promise<unknown>> };
const queues = globals.cowboyStoreQueues ??= new Map();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export class AccountError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 401 | 409 = 400) { super(message); }
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
      || (ticket.market !== undefined && !["moneyline", "spread", "total"].includes(ticket.market))
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
        data = { version: 1, users: [], sessions: [], tickets: [] };
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
      data.users.push({ ...user, salt, passwordHash });
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
    return { user: { id: user.id, username: user.username }, token };
  }

  userInData(data: StoreData, token: string | null | undefined): AccountUser | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = data.sessions.find((entry) => entry.hash === digest(token) && entry.expiresAt > this.now());
    const user = session && data.users.find((entry) => entry.id === session.userId);
    return user ? { id: user.id, username: user.username,
      ...(user.email ? { email: user.email, emailVerified: user.emailVerifiedAt !== undefined } : {}) } : null;
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

  async consensus(): Promise<PickConsensus> {
    return this.transaction((data) => buildPickConsensus(data.tickets), false);
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
