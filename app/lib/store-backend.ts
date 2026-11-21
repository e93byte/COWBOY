import { AccountStore, type AccountUser, type StoredPick } from "./account-store";
import type { FollowPreference } from "./follow-preferences";
import type { PickConsensus } from "./pick-consensus";
import type { PublicLeaderboardEntry } from "./pick-leaderboard";
import type { ParlayLeg } from "./parlay";
import type { Contest, ContestStanding } from "./account-store";
import { SupabaseStore, supabaseConfig } from "./supabase-store";

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
  listParlays(token: string | null): Promise<StoredParlay[]>;
  consensus(): Promise<PickConsensus>;
  publicLeaderboard(): Promise<PublicLeaderboardEntry[]>;
  setLeaderboardOptIn(token: string | null, enabled: boolean): Promise<AccountUser>;
  savePicks(token: string | null, tickets: StoredPick[]): Promise<StoredPick[]>;
  saveParlay(token: string | null, parlay: StoredParlay): Promise<StoredParlay[]>;
  settleParlays(token: string | null, updates: Array<{ id: string; status: StoredParlay["status"]; settledAt: string }>): Promise<StoredParlay[]>;
  changePick(token: string | null, id: string, action: "cancel" | "edit", side: string | null, selection: string | null, revision: number | null, now?: number, line?: number | null): Promise<StoredPick>;
  settlePicks(token: string | null, updates: Array<{ id: string; status: StoredPick["status"]; settledAt: string }>): Promise<StoredPick[]>;
  setEmail(token: string | null, email: string): Promise<{ email: string; verifyToken: string }>;
  verifyEmail(rawToken: string): Promise<boolean>;
  requestPasswordReset(username: string): Promise<{ email: string; resetToken: string } | null>;
  resetPassword(rawToken: string, password: string): Promise<void>;
  listContests(): Promise<Contest[]>;
  joinContest(contestId: string, token: string | null): Promise<{ joined: boolean }>;
  contestStandings(contestId: string): Promise<ContestStanding[]>;
  getTokens(token: string | null): Promise<{ tokens: number; ledger: Array<{amount:number;reason:string;at:string;awardKey?:string}> }>;
  awardTokens(token: string | null, userId: string, amount: number, reason: string, awardKey: string): Promise<void>;
  adjustTokens(token: string | null, userId: string, amount: number, reason: string, awardKey: string): Promise<void>;
}

const globals = globalThis as typeof globalThis & { cowboyBackend?: AccountBackend };

export function getAccountBackend(): AccountBackend {
  if (globals.cowboyBackend) return globals.cowboyBackend;
  const config = supabaseConfig();
  globals.cowboyBackend = config ? new SupabaseStore(config) : new AccountStore();
  return globals.cowboyBackend;
}

export function setAccountBackend(backend: AccountBackend | undefined) {
  globals.cowboyBackend = backend;
}
