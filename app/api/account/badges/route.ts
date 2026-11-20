import { getAccountBackend } from "../../../lib/store-backend";
import { response, safely, sessionToken } from "../handlers";
import { AccountError } from "../../../lib/account-store";

export type Badge = { id: string; label: string; earned: boolean; progress: number; target: number };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badgesFor(user: { id: string }, tickets: Array<{ status: string; market?: string | null; prop?: unknown }>, parlays: Array<{ status: string }>): Badge[] {
  const won = tickets.filter(t => t.status === "won").length;
  const open = tickets.filter(t => t.status === "open").length;
  const settled = tickets.filter(t => t.status === "won" || t.status === "lost").length;
  const propPicks = tickets.filter(t => t.market === "prop").length;
  const hasParlay = parlays.length > 0;
  return [
    { id: 'first_pick', label: 'First Pick', earned: tickets.length > 0, progress: Math.min(tickets.length, 1), target: 1 },
    { id: 'five_wins', label: 'Five Wins', earned: won >= 5, progress: Math.min(won, 5), target: 5 },
    { id: 'ten_wins', label: 'Ten Wins', earned: won >= 10, progress: Math.min(won, 10), target: 10 },
    { id: 'streak_starter', label: 'Settled Five', earned: settled >= 5, progress: Math.min(settled, 5), target: 5 },
    { id: 'prop_player', label: 'Prop Player', earned: propPicks > 0, progress: Math.min(propPicks, 1), target: 1 },
    { id: 'parlay_player', label: 'Parlay Builder', earned: hasParlay, progress: hasParlay ? 1 : 0, target: 1 },
    { id: 'active_picker', label: 'Active Picker', earned: open > 0, progress: Math.min(open, 1), target: 1 },
  ];
}

export const GET = (request: Request) => safely(async () => {
  const token = sessionToken(request);
  if (!token) throw new AccountError("unauthorized", "Sign in to view your badges.", 401);
  const backend = getAccountBackend();
  const [user, tickets, parlays] = await Promise.all([
    backend.getUser(token),
    backend.listPicks(token),
    backend.listParlays(token),
  ]);
  if (!user) throw new AccountError("unauthorized", "Invalid session.", 401);
  return response({ badges: badgesFor(user, tickets, parlays) });
});
