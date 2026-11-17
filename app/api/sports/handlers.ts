import { getCachedScoreboardEvent, getLiveBoard, getLiveEvent, LIVE_LEAGUES, LiveSportsError } from '../../lib/live-sports';

type SportsClient = {
  getLiveBoard: typeof getLiveBoard;
  getLiveEvent: typeof getLiveEvent;
  getCachedScoreboardEvent?: typeof getCachedScoreboardEvent;
};
const headers = { 'Cache-Control': 'no-store' };

function failure(error: unknown) {
  const known = error instanceof LiveSportsError;
  return Response.json({
    error: known ? error.message : 'Sports source is unavailable; try again shortly',
    source: 'ESPN', ...(known && error.board ? { board: error.board } : {}),
  }, { status: known ? error.status : 502, headers });
}

export function createSportsHandlers(client: SportsClient = { getLiveBoard, getLiveEvent, getCachedScoreboardEvent }) {
  return {
    async board(request?: Request) {
      try {
        const leagues = request ? new URL(request.url).searchParams.getAll('league') : [];
        if (leagues.length > 1 || (leagues.length === 1 && !LIVE_LEAGUES.some(config => config.id === leagues[0]))) {
          throw new LiveSportsError('Supply one supported league key', 400);
        }
        return Response.json(await client.getLiveBoard(leagues[0]), { headers });
      } catch (error) { return failure(error); }
    },
    async event(request: Request) {
      try {
        const params = new URL(request.url).searchParams;
        const league = params.get('league') ?? '';
        const id = params.get('id') ?? '';
        if (params.getAll('league').length !== 1 || params.getAll('id').length !== 1 ||
            !LIVE_LEAGUES.some(config => config.id === league && config.sport !== 'golf') ||
            !/^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id)) {
          throw new LiveSportsError('Supply one supported league key and one valid event id', 400);
        }
        let unavailable: unknown;
        try {
          const event = await client.getLiveEvent(league, id);
          if (event) return Response.json(event, { headers });
        } catch (error) {
          if (error instanceof LiveSportsError && error.status === 400) throw error;
          unavailable = error;
        }
        const fallback = client.getCachedScoreboardEvent?.(league, id);
        if (fallback) return Response.json({...fallback, stale: true, fallback: 'scoreboard'}, {headers});
        if (unavailable) throw unavailable;
        return Response.json({ error: 'Event not found on the available ESPN schedule', source: 'ESPN' }, { status: 404, headers });
      } catch (error) { return failure(error); }
    },
  };
}
