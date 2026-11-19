import assert from "node:assert/strict";
import { test } from "node:test";
import { createSportsNewsClient } from "../app/lib/sports-news";

const article = {
  id: "401234567",
  headline: "Lakers sign extension",
  description: "The guard agreed to a multiyear deal.",
  published: "2026-11-18T10:00:00Z",
  links: { web: { href: "https://www.espn.com/nba/story/_/id/401234567/lakers" } },
  categories: [{ description: "NBA" }],
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("sports news normalizes ESPN articles and drops unusable entries", async () => {
  const client = createSportsNewsClient({
    fetch: async () => jsonResponse({ articles: [
      article,
      { headline: "No link", published: "2026-11-18T10:00:00Z" },
      { ...article, id: "2", links: { web: { href: "http://insecure.example.com/x" } } },
      { ...article, id: "3", headline: "" },
    ] }),
  });
  const news = await client.get("nba");
  assert.equal(news.length, 1);
  assert.equal(news[0].headline, "Lakers sign extension");
  assert.equal(news[0].category, "NBA");
  assert.equal(news[0].publishedAt, "2026-11-18T10:00:00Z");
  assert.ok(news[0].url.startsWith("https://"));
});

test("sports news caches per league and backs off after failures", async () => {
  let clock = 1_000_000;
  let calls = 0;
  const client = createSportsNewsClient({
    now: () => clock,
    fetch: async () => { calls++; return jsonResponse({ articles: [article] }); },
  });
  await client.get("nba");
  await client.get("nba");
  assert.equal(calls, 1);
  clock += 16 * 60_000;
  await client.get("nba");
  assert.equal(calls, 2);
});

test("sports news rejects unsupported leagues without fetching", async () => {
  let calls = 0;
  const client = createSportsNewsClient({ fetch: async () => { calls++; return jsonResponse({}); } });
  assert.deepEqual(await client.get("not-a-league"), []);
  assert.equal(calls, 0);
});
