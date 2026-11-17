import type {LiveBoard} from './live-sports';

export function saveOfflineScoreboard(board: LiveBoard) {
  if (board.source !== 'ESPN' || board.stale || !Number.isFinite(Date.parse(board.fetchedAt))) return;
  const available = new Set(board.leagues.filter(league=>league.status==='ok').map(league=>league.id));
  if (!available.size) return;
  const games = board.events.filter(event=>available.has(event.league) && Number.isFinite(Date.parse(event.startsAt)) &&
    typeof event.away?.name==='string' && typeof event.home?.name==='string')
    .slice(0, 250).map(event=>({
      league: event.leagueName,
      status: event.status,
      statusText: event.statusText,
      startsAt: event.startsAt,
      away: {name:event.away.name,score:event.status==='scheduled'?null:event.away.score},
      home: {name:event.home.name,score:event.status==='scheduled'?null:event.home.score},
    }));
  try {
    localStorage.setItem('cowboy.offlineBoard.v1',JSON.stringify({source:board.source,fetchedAt:board.fetchedAt,games}));
  } catch {
    // The online board still works when browser storage is restricted.
  }
}
