import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicPickLeaderboard } from "../app/lib/pick-leaderboard";

const picks = (userId: string, count: number, status: "won" | "lost" = "won") =>
  Array.from({ length: count }, (_, index) => ({
    userId, league: "nba", eventId: `event-${index}`, status,
  }));

test("public leaderboard includes only opted-in users with ten source-decided events", () => {
  const rows = buildPublicPickLeaderboard([
    { id: "opt-in", username: "CourtSide", leaderboardOptIn: true },
    { id: "private", username: "PrivateUser", leaderboardOptIn: false },
    { id: "too-few", username: "NewUser", leaderboardOptIn: true },
  ], [
    ...picks("opt-in", 9),
    { userId: "opt-in", league: "nba", eventId: "event-lost", status: "lost" },
    ...picks("private", 20),
    ...picks("too-few", 9),
    { userId: "opt-in", league: "nba", eventId: "open", status: "open" },
    { userId: "opt-in", league: "nba", eventId: "void", status: "void" },
  ]);
  assert.deepEqual(rows, [{ rank: 1, username: "CourtSide", decidedEvents: 10, wins: 9, accuracy: 0.9 }]);
  assert.equal(JSON.stringify(rows).includes("userId"), false);
});

test("multiple markets for one game count once and the event counts as won only if all decided legs won", () => {
  const rows = buildPublicPickLeaderboard([
    { id: "player", username: "Accurate", leaderboardOptIn: true },
  ], [
    ...Array.from({ length: 9 }, (_, index) => ({userId:"player",league:"nba",eventId:`event-${index}`,status:"won" as const})),
    {userId:"player",league:"nba",eventId:"same-game",status:"won"},
    {userId:"player",league:"nba",eventId:"same-game",status:"lost"},
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decidedEvents, 10);
  assert.equal(rows[0].wins, 9);
  assert.equal(rows[0].accuracy, 0.9);
});
