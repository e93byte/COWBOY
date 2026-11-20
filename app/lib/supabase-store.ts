import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AccountError, SESSION_MAX_AGE, type AccountUser, type StoredPick } from "./account-store";
import type { FollowPreference } from "./follow-preferences";
import type { PickConsensus } from "./pick-consensus";
import { buildPickConsensus } from "./pick-consensus";

const scrypt = promisify(scryptCallback);
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export type SupabaseConfig = { url: string; serviceKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = (process.env.COWBOY_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return url && serviceKey ? { url, serviceKey } : null;
}

type RpcError = { code?: string; message?: string; details?: string };

async function rpc<T>(config: SupabaseConfig, fn: string, args: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch {
    throw new AccountError("storage_unavailable", "Account storage is temporarily unavailable.", 409);
  }
  if (!response.ok) {
    let detail: RpcError = {};
    try { detail = await response.json() as RpcError; } catch { /* keep defaults */ }
    const message = typeof detail.message === "string" ? detail.message : "";
    if (message === "unauthorized") throw new AccountError("unauthorized", "Sign in to manage your free picks.", 401);
    if (message === "username_taken") throw new AccountError("username_taken", "That username is already registered.", 409);
    if (message === "request_replayed") throw new AccountError("request_replayed", "This request was already submitted. Review your existing tickets.", 409);
    if (message === "duplicate_pick") throw new AccountError("duplicate_pick", "You already submitted a pick for a selected event.", 409);
    if (message === "event_locked") throw new AccountError("event_locked", "This ticket is already locked.", 409);
    if (message === "pick_changed") throw new AccountError("pick_changed", "This pick changed. Close this dialog and refresh My picks to see the current selection.", 409);
    if (message === "ticket_unavailable") throw new AccountError("ticket_unavailable", "This ticket is unavailable.", 409);
    if (message === "invalid_input") throw new AccountError("invalid_input", "Supply valid account data.");
    throw new AccountError("storage_unavailable", "Account storage is temporarily unavailable.", 409);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function validateCredentials(username: unknown, password: unknown): asserts username is string {
  if (typeof username !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]{2,29}$/.test(username)
    || typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new AccountError("invalid_input", "Use a 3–30 character username (letters, digits, _ or -) and a 10–128 character password.");
  }
}

const tokenHash = (token: string | null | undefined) =>
  token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;

export class SupabaseStore {
  constructor(private readonly config: SupabaseConfig, private readonly now: () => number = Date.now) {}

  private async sessionUser(token: string | null | undefined): Promise<AccountUser | null> {
    const hash = tokenHash(token);
    if (!hash) return null;
    const user = await rpc<AccountUser | null>(this.config, "cowboy_session_user", { p_token_hash: hash });
    return user ?? null;
  }

  async register(username: string, password: string) {
    validateCredentials(username, password);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
    const token = randomBytes(32).toString("hex");
    const user = await rpc<AccountUser>(this.config, "cowboy_register", {
      p_username: username, p_username_key: username.toLowerCase(),
      p_salt: salt, p_password_hash: passwordHash, p_token_hash: digest(token),
    });
    return { user, token };
  }

  async login(username: string, password: string) {
    validateCredentials(username, password);
    const record = await rpc<{ id: string; username: string; salt: string; passwordHash: string } | null>(
      this.config, "cowboy_lookup_user", { p_username_key: username });
    const hash = await scrypt(password, record?.salt ?? "00000000000000000000000000000000", 64) as Buffer;
    if (!record || !timingSafeEqual(hash, Buffer.from(record.passwordHash, "hex"))) {
      throw new AccountError("invalid_credentials", "Username or password is incorrect.", 401);
    }
    const token = randomBytes(32).toString("hex");
    await rpc(this.config, "cowboy_create_session", { p_user_id: record.id, p_token_hash: digest(token) });
    return { user: { id: record.id, username: record.username }, token };
  }

  async getUser(token: string | null | undefined) { return this.sessionUser(token); }

  async logout(token: string | null | undefined) {
    const hash = tokenHash(token);
    if (!hash) return;
    await rpc(this.config, "cowboy_logout", { p_token_hash: hash });
  }

  private async credentials(token: string | null | undefined) {
    const hash = tokenHash(token);
    if (!hash) return null;
    return rpc<{ id: string; username: string; salt: string; passwordHash: string } | null>(
      this.config, "cowboy_session_credentials", { p_token_hash: hash });
  }

  async deleteAccount(token: string | null, password: string) {
    const record = await this.credentials(token);
    if (!record) throw new AccountError("unauthorized", "Sign in to manage your free picks.", 401);
    validateCredentials(record.username, password);
    const hash = await scrypt(password, record.salt, 64) as Buffer;
    if (!timingSafeEqual(hash, Buffer.from(record.passwordHash, "hex"))) {
      throw new AccountError("invalid_credentials", "Password is incorrect.", 401);
    }
    await rpc(this.config, "cowboy_delete_account", { p_token_hash: tokenHash(token)! });
  }

  async revokeOtherSessions(token: string | null) {
    const hash = tokenHash(token);
    if (!hash) return 0;
    return rpc<number>(this.config, "cowboy_revoke_other_sessions", { p_token_hash: hash });
  }

  async getFollows(token: string | null): Promise<FollowPreference[]> {
    const follows = await rpc<FollowPreference[]>(this.config, "cowboy_get_follows", { p_token_hash: tokenHash(token)! });
    return follows ?? [];
  }

  async setFollows(token: string | null, follows: FollowPreference[]): Promise<FollowPreference[]> {
    const saved = await rpc<FollowPreference[]>(this.config, "cowboy_set_follows", {
      p_token_hash: tokenHash(token)!, p_follows: follows,
    });
    return saved ?? [];
  }

  async exportAccount(token: string | null) {
    return rpc<unknown>(this.config, "cowboy_export_account", { p_token_hash: tokenHash(token)! });
  }

  async listPicks(token: string | null): Promise<StoredPick[]> {
    const rows = await rpc<StoredPick[]>(this.config, "cowboy_list_picks", { p_token_hash: tokenHash(token)! });
    return rows ?? [];
  }

  async consensus(): Promise<PickConsensus> {
    const rows = await rpc<Array<PickConsensusTicket>>(this.config, "cowboy_consensus_rows", {});
    return buildPickConsensus((rows ?? []).map(row => ({
      ...row, id: "", eventName: "", selection: "", startsAt: "", createdAt: "",
      settledAt: row.updatedAt ?? null, requestId: "", homeId: "", awayId: "",
    })));
  }

  async savePicks(token: string | null, tickets: StoredPick[]): Promise<StoredPick[]> {
    const picks = tickets.map(ticket => ({
      eventId: ticket.eventId, league: ticket.league, side: ticket.side, requestId: ticket.requestId,
      eventName: ticket.eventName, selection: ticket.selection, startsAt: ticket.startsAt,
      createdAt: ticket.createdAt, homeId: ticket.homeId, awayId: ticket.awayId,
      market: ticket.market ?? "moneyline", line: ticket.line ?? null,
    }));
    return rpc<StoredPick[]>(this.config, "cowboy_save_picks", { p_token_hash: tokenHash(token)!, p_picks: picks });
  }

  async changePick(token: string | null, id: string, action: "cancel" | "edit", side: string | null, selection: string | null, revision: number | null, now?: number, line?: number | null) {
    return rpc<StoredPick>(this.config, "cowboy_change_pick", {
      p_token_hash: tokenHash(token)!, p_ticket_id: id, p_action: action,
      p_side: side, p_selection: selection, p_revision: revision, p_line: line ?? null,
      p_now: new Date(now ?? this.now()).toISOString(),
    });
  }

  async settlePicks(token: string | null, updates: Array<{ id: string; status: StoredPick["status"]; settledAt: string }>) {
    return rpc<StoredPick[]>(this.config, "cowboy_settle_picks", {
      p_token_hash: tokenHash(token)!, p_updates: updates,
    });
  }
}

type PickConsensusTicket = {
  userId: string; eventId: string; league: string; side: StoredPick["side"];
  market?: StoredPick["market"]; status: StoredPick["status"]; changes?: StoredPick["changes"]; createdAt: string; updatedAt: string | null;
};
