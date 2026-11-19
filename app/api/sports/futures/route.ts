import { getLeagueFutures } from "../../../lib/futures-markets";
import { LIVE_LEAGUES } from "../../../lib/sports-leagues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") ?? "";
  const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
  if (params.getAll("league").length !== 1 ||
      !LIVE_LEAGUES.some(config => config.id === league)) {
    return Response.json({ error: "Supply one supported league key" }, { status: 400, headers });
  }
  try {
    const futures = await getLeagueFutures(league);
    return Response.json({ futures }, { headers });
  } catch {
    return Response.json({ futures: null }, { status: 200, headers });
  }
}
