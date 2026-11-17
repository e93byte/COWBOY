import { getLiveBoard, getLiveEvent, LIVE_LEAGUES, LiveSportsError } from '../../lib/live-sports';

type SportsClient = { getLiveBoard: typeof getLiveBoard; getLiveEvent: typeof getLiveEvent };
const headers = { 'Cache-Control': 'no-store' };

function failure(error: unknown) {
  const known = error instanceof LiveSportsError;
  return Response.json({
    error: known ? error.message : 'Sports source is unavailable; try again shortly',
    source: 'ESPN', ...(known && error.board ? { board: error.board } : {}),
  }, { status: known ? error.status : 502, headers });
}

export function createSportsHandlers(client: SportsClient = { getLiveBoard, getLiveEvent }) {
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
        const event = await client.getLiveEvent(league, id);
        return event ? Response.json(event, { headers }) : Response.json({ error: 'Event not found on the available ESPN schedule', source: 'ESPN' }, { status: 404, headers });
      } catch (error) { return failure(error); }
    },
  };
}
