import { getSportsNews } from "../../../lib/sports-news";
import { LIVE_LEAGUES, LiveSportsError } from "../../../lib/live-sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };

export async function GET(request: Request) {
  try {
    const league = new URL(request.url).searchParams.get("league") ?? "";
    if (!LIVE_LEAGUES.some(config => config.id === league)) {
      throw new LiveSportsError("Supply one supported league key", 400);
    }
    return Response.json({ league, articles: await getSportsNews(league) }, { headers });
  } catch (error) {
    const known = error instanceof LiveSportsError;
    return Response.json(
      { error: known ? error.message : "News source is unavailable; try again shortly" },
      { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
