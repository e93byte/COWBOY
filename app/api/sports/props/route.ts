import { getPlayerProps } from "../../../lib/player-props";
import { LIVE_LEAGUES } from "../../../lib/sports-leagues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROP_SPORTS = new Set(["football", "basketball", "baseball", "hockey", "soccer"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") ?? "";
  const id = params.get("id") ?? "";
  const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
  const config = LIVE_LEAGUES.find(entry => entry.id === league);
  if (params.getAll("league").length !== 1 || params.getAll("id").length !== 1 ||
      !config || config.sport === "golf" || !PROP_SPORTS.has(config.sport) ||
      !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id)) {
    return Response.json({ error: "Supply one supported league key and one valid event id" }, { status: 400, headers });
  }
  try {
    const props = await getPlayerProps(league, id);
    return Response.json({ props }, { headers });
  } catch {
    return Response.json({ props: null }, { status: 200, headers });
  }
}
