import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RealPickTicket } from "./pick-service";
import { followKey, isFollowPreference, type FollowPreference } from "./follow-preferences";

const scrypt = promisify(scryptCallback);
export type AccountUser = { id: string; username: string };
type StoredUser = AccountUser & { salt: string; passwordHash: string; follows?: FollowPreference[] };
type StoredSession = { hash: string; userId: string; expiresAt: number };
export type StoredPick = RealPickTicket & { userId: string; requestId: string; homeId: string; awayId: string };
export type StoreData = { version: 1; users: StoredUser[]; sessions: StoredSession[]; tickets: StoredPick[] };
export type StoreOptions = { directory?: string; now?: () => number };
const SESSION_SECONDS = 60 * 60 * 24 * 7;
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
      || !["home", "away", "draw"].includes(ticket.side) || !["open", "won", "lost", "void", "cancelled"].includes(ticket.status)
      || !date(ticket.startsAt) || !date(ticket.createdAt)
      || (ticket.status === "open" ? ticket.settledAt !== null : !date(ticket.settledAt))) fail();
    if (ticket.changes !== undefined && (!Array.isArray(ticket.changes) || ticket.changes.some(change =>
      !change || !["home", "away", "draw"].includes(change.side) || !nonempty(change.selection) || !date(change.changedAt)))) fail();
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
    const event = JSON.stringify([ticket.userId, ticket.league, ticket.eventId]);
    if (tickets.has(ticket.id) || requests.has(request) || events.has(event)) fail();
    tickets.add(ticket.id); requests.add(request); events.add(event);
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
    return user ? { id: user.id, username: user.username } : null;
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
}
