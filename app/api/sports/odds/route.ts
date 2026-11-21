import { NextRequest, NextResponse } from 'next/server';
import { getLiveEvent } from '../../../lib/live-sports';
import { normalizeOdds } from '../../../lib/live-sports';

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

    const event = await getLiveEvent(league, id);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const odds = event.odds ?? null;
    const oddsBooks = event.oddsBooks ?? [];

    return NextResponse.json({
      eventId: event.id,
      league: event.league,
      name: event.name,
      startsAt: event.startsAt,
      status: event.status,
      odds,
      oddsBooks,
      provider: odds?.provider ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to fetch odds' }, { status: 500 });
  }
}
