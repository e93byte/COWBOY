import { AccountStore, type AccountUser, type StoredPick } from "./account-store";
import type { FollowPreference } from "./follow-preferences";
import type { PickConsensus } from "./pick-consensus";
import { SupabaseStore, supabaseConfig } from "./supabase-store";

// Backend-agnostic account/pick storage. The file store remains the default for
// local development and tests; Supabase activates when its env vars are set.
export interface AccountBackend {
  register(username: string, password: string): Promise<{ user: AccountUser; token: string }>;
  login(username: string, password: string): Promise<{ user: AccountUser; token: string }>;
  getUser(token: string | null | undefined): Promise<AccountUser | null>;
  logout(token: string | null | undefined): Promise<void>;
  deleteAccount(token: string | null, password: string): Promise<void>;
  revokeOtherSessions(token: string | null): Promise<number>;
  getFollows(token: string | null): Promise<FollowPreference[]>;
  setFollows(token: string | null, follows: FollowPreference[]): Promise<FollowPreference[]>;
  exportAccount(token: string | null): Promise<unknown>;
  listPicks(token: string | null): Promise<StoredPick[]>;
  consensus(): Promise<PickConsensus>;
  savePicks(token: string | null, tickets: StoredPick[]): Promise<StoredPick[]>;
  changePick(token: string | null, id: string, action: "cancel" | "edit", side: string | null, selection: string | null, revision: number | null, now?: number): Promise<StoredPick>;
  settlePicks(token: string | null, updates: Array<{ id: string; status: StoredPick["status"]; settledAt: string }>): Promise<StoredPick[]>;
}

const globals = globalThis as typeof globalThis & { cowboyBackend?: AccountBackend };

export function getAccountBackend(): AccountBackend {
  if (globals.cowboyBackend) return globals.cowboyBackend;
  const config = supabaseConfig();
  globals.cowboyBackend = config ? new SupabaseStore(config) : new AccountStore();
  return globals.cowboyBackend;
}

// Test hook: forces a specific backend (file store in unit tests).
export function setAccountBackend(backend: AccountBackend | undefined) {
  globals.cowboyBackend = backend;
}
