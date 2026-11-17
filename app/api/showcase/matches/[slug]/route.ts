import { NextResponse } from "next/server";

export const revalidate = 60;

type UpstreamStat = { label?: string; home?: number | string; away?: number | string; home_pct?: number; away_pct?: number; suffix?: string };
type UpstreamIncident = { time?: number; type?: string; side?: string; player?: string; home_score?: number; away_score?: number };
type UpstreamMatch = {
  home?: string; away?: string; home_score?: string | null; away_score?: string | null; status?: string;
  status_text?: string; live_minute?: string | number; time?: string; competition?: string;
  stats?: UpstreamStat[] | null; incidents?: UpstreamIncident[] | null;
};

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const safeSlug = decodeURIComponent(slug);
    if (!/^[a-z0-9-]{2,120}$/.test(safeSlug)) {
      return NextResponse.json({ error: "invalid_match" }, { status: 400 });
    }
    const url = `https://sportscore.com/api/widget/match/?sport=football&slug=${encodeURIComponent(safeSlug)}`;
    const response = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const payload = await response.json() as { match?: UpstreamMatch; updated?: string; error?: string };
    if (!payload.match) return NextResponse.json({ error: "match_unavailable" }, { status: 404 });
    const match = payload.match;
    return NextResponse.json({
      match: {
        home: match.home ?? "Home", away: match.away ?? "Away",
        homeScore: match.home_score ?? null, awayScore: match.away_score ?? null,
        status: match.status ?? "unknown", statusText: match.status_text ?? "Status unavailable",
        minute: match.live_minute ?? null, time: match.time ?? null, competition: match.competition ?? "Competition",
        stats: match.stats ?? [], incidents: match.incidents ?? [],
      },
      sourceUpdatedAt: payload.updated ?? null,
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "live_feed_unavailable", message: "Live match details could not be refreshed." }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
