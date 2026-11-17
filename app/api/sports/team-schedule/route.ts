import { getTeamSchedule, LIVE_LEAGUES, LiveSportsError } from '../../../lib/live-sports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const {searchParams} = new URL(request.url);
  const league = searchParams.get('league') ?? '';
  const team = searchParams.get('team') ?? '';
  const config = LIVE_LEAGUES.find(item=>item.id===league);
  if (!config || ['golf','mma','tennis'].includes(config.sport) || !/^[0-9]{1,10}$/.test(team) ||
      searchParams.getAll('league').length !== 1 || searchParams.getAll('team').length !== 1) {
    return Response.json({error:'Supply a supported league and one team ID'},{status:400,headers});
  }
  try {
    return Response.json({events:await getTeamSchedule(league,team)},{headers});
  } catch (error) {
    const status = error instanceof LiveSportsError && error.status===429 ? 429 : 502;
    return Response.json({error:'Team schedule is unavailable'},{status,headers});
  }
}
