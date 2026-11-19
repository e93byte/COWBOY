import { getMarketReference } from "../../../lib/market-reference";
import { LIVE_LEAGUES } from "../../../lib/sports-leagues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") ?? "";
  const id = params.get("id") ?? "";
  const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
  if (params.getAll("league").length !== 1 || params.getAll("id").length !== 1 ||
      !LIVE_LEAGUES.some(config => config.id === league && config.sport !== "golf") ||
      !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id)) {
    return Response.json({ error: "Supply one supported league key and one valid event id" }, { status: 400, headers });
  }
  try {
    const market = await getMarketReference(league, id);
    return Response.json({ market }, { headers });
  } catch {
    return Response.json({ market: null }, { status: 200, headers });
  }
}
