import { NextResponse } from "next/server";

export const revalidate = 60;

type UpstreamMatch = {
  home?: string;
  away?: string;
  home_score?: string | null;
  away_score?: string | null;
  status?: string;
  status_text?: string;
  time?: string;
  competition?: string;
  url?: string;
};

export async function GET() {
  try {
    const response = await fetch("https://sportscore.com/api/widget/matches/?sport=football&limit=20", {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    const payload = await response.json() as { matches?: UpstreamMatch[]; updated?: string };
    const matches = (payload.matches ?? []).map((match) => {
      const parts = (match.url ?? "").split("/").filter(Boolean);
      const home = typeof match.home === "string" ? match.home.trim() : "";
      const away = typeof match.away === "string" ? match.away.trim() : "";
      const competition = typeof match.competition === "string" ? match.competition.trim() : "";
      return {
        slug: parts[2] ?? "",
        home,
        away,
        homeScore: match.home_score ?? null,
        awayScore: match.away_score ?? null,
        status: match.status ?? "unknown",
        statusText: match.status_text ?? "Status unavailable",
        time: match.time ?? null,
        competition: competition || null,
      };
    }).filter((match) => match.slug && match.home && match.away);

    return NextResponse.json({ sport: "football", matches, sourceUpdatedAt: payload.updated ?? null, fetchedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "live_feed_unavailable", message: "The live scores feed is temporarily unavailable." }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
