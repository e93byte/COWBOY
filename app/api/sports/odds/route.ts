import { NextRequest, NextResponse } from 'next/server';
import { fetchOddsWithFallback } from '../../../lib/hybrid-odds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const league = searchParams.get('league');
    const id = searchParams.get('id');

    if (!league || !id) {
      return NextResponse.json({ error: 'league and id are required' }, { status: 400 });
    }

    const result = await fetchOddsWithFallback(league, id);

    return NextResponse.json({
      eventId: result.eventId,
      league: result.league,
      name: result.name,
      startsAt: result.startsAt,
      status: result.status,
      odds: result.odds,
      oddsBooks: result.oddsBooks,
      provider: result.provider,
      source: result.source,
      freshness: result.freshness,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to fetch odds' }, { status: 500 });
  }
}
