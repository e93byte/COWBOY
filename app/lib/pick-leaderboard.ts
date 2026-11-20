export type LeaderboardProfile = { id: string; username: string; leaderboardOptIn?: boolean };
export type LeaderboardPick = {
  userId: string;
  league: string;
  eventId: string;
  status: "open" | "won" | "lost" | "void" | "cancelled";
};
export type PublicLeaderboardEntry = {
  rank: number;
  username: string;
  decidedEvents: number;
  wins: number;
  accuracy: number;
};

const MINIMUM_DECIDED_EVENTS = 10;
const PUBLIC_LIMIT = 25;

/**
 * A privacy-opt-in ranking from source-graded free picks only. Multiple settled
 * markets in one event count as one forecast; an event is a win only when every
 * non-void decided pick for it won. No token balance, stake, or payout is used.
 */
export function buildPublicPickLeaderboard(
  users: LeaderboardProfile[],
  picks: LeaderboardPick[],
): PublicLeaderboardEntry[] {
  const optedIn = new Map(users.filter(user => user.leaderboardOptIn === true).map(user => [user.id, user]));
  const byUserEvent = new Map<string, { userId: string; league: string; eventId: string; outcomes: Array<"won" | "lost"> }>();
  for (const pick of picks) {
    if (!optedIn.has(pick.userId) || (pick.status !== "won" && pick.status !== "lost")) continue;
    const key = `${pick.userId}:${pick.league}:${pick.eventId}`;
    const event = byUserEvent.get(key) ?? { userId: pick.userId, league: pick.league, eventId: pick.eventId, outcomes: [] };
    event.outcomes.push(pick.status);
    byUserEvent.set(key, event);
  }
  const totals = new Map<string, { decidedEvents: number; wins: number }>();
  for (const event of byUserEvent.values()) {
    const total = totals.get(event.userId) ?? { decidedEvents: 0, wins: 0 };
    total.decidedEvents++;
    if (event.outcomes.every(outcome => outcome === "won")) total.wins++;
    totals.set(event.userId, total);
  }
  return [...totals.entries()]
    .flatMap(([userId, total]) => {
      const user = optedIn.get(userId);
      if (!user || total.decidedEvents < MINIMUM_DECIDED_EVENTS) return [];
      return [{ rank: 0, username: user.username, ...total, accuracy: total.wins / total.decidedEvents }];
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.decidedEvents - a.decidedEvents || a.username.localeCompare(b.username))
    .slice(0, PUBLIC_LIMIT)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
