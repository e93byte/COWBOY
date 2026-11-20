import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPublicPickLeaderboard } from "../app/lib/pick-leaderboard";
import { AccountStore } from "../app/lib/account-store";
import { setAccountBackend } from "../app/lib/store-backend";
import { GET as getPublicLeaderboard } from "../app/api/leaderboard/route";
import { GET as getPreference, POST as setPreference } from "../app/api/account/leaderboard/route";

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

test("account leaderboard visibility preference persists and defaults to private", async () => {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "cowboy-leaderboard-"));
  try {
    const store = new AccountStore({directory});
    const {user,token} = await store.register("PrivateRider", "correct-horse-leaderboard-password");
    assert.equal(user.leaderboardOptIn, undefined);
    assert.equal((await store.publicLeaderboard()).length, 0);
    await store.setLeaderboardOptIn(token, true);
    assert.equal((await store.getUser(token))?.leaderboardOptIn, true);
    await store.setLeaderboardOptIn(token, false);
    assert.notEqual((await store.getUser(token))?.leaderboardOptIn, true);
    assert.equal((await store.publicLeaderboard()).length, 0);
  } finally {
    await rm(directory,{recursive:true,force:true});
  }
});

test("leaderboard HTTP routes expose aggregates publicly and protect opt-in behind the session", async () => {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "cowboy-leaderboard-api-"));
  const store = new AccountStore({directory});
  try {
    setAccountBackend(store);
    const {token} = await store.register("OptInRider", "correct-horse-leaderboard-password");
    const publicResponse = await getPublicLeaderboard();
    assert.deepEqual(await publicResponse.json(), {entries:[]});
    const privateResponse = await getPreference(new Request("http://cowboy.test/api/account/leaderboard"));
    assert.equal(privateResponse.status, 401);
    const cookie = `cowboy_session=${token}`;
    const request = (enabled: boolean) => new Request("http://cowboy.test/api/account/leaderboard", {
      method:"POST", headers:{origin:"http://cowboy.test",host:"cowboy.test",cookie,"content-type":"application/json"},
      body:JSON.stringify({enabled}),
    });
    const saved = await setPreference(request(true));
    assert.deepEqual(await saved.json(), {enabled:true});
    const read = await getPreference(new Request("http://cowboy.test/api/account/leaderboard", {headers:{cookie}}));
    assert.deepEqual(await read.json(), {enabled:true});
    const optedOut = await setPreference(request(false));
    assert.deepEqual(await optedOut.json(), {enabled:false});
  } finally {
    setAccountBackend(undefined);
    await rm(directory,{recursive:true,force:true});
  }
});
