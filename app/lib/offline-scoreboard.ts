import type {LiveBoard} from './live-sports';

const storageKey = 'cowboy.offlineBoard.v1';

export function openSavedBoardOnStandaloneStartup() {
  const {pathname, search} = window.location;
  if (pathname !== '/' && pathname !== '/live') return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true;
  if (!standalone || !navigator.serviceWorker?.controller) return;
  try {
    if (localStorage.getItem(storageKey)) {
      const resume = new URLSearchParams({resume: pathname + search});
      window.location.replace(`/offline.html?${resume}`);
    }
  } catch {
    // The interactive retry remains available when storage is restricted.
  }
}

export function saveOfflineScoreboard(board: LiveBoard) {
  if (board.source !== 'ESPN' || !Number.isFinite(Date.parse(board.fetchedAt))) return;
  if (board.stale && board.leagues.every(league=>league.status==='ok')) return;
  const available = new Map(board.leagues.filter(league=>league.status==='ok').map(league=>[league.id,league.lastSuccessAt]));
  if (!available.size) return;
  const games = board.events.filter(event=>available.has(event.league) && Number.isFinite(Date.parse(event.startsAt)) &&
    typeof event.away?.name==='string' && typeof event.home?.name==='string')
    .slice(0, 250).map(event=>({
      league: event.leagueName,
      status: event.status,
      statusText: event.statusText,
      startsAt: event.startsAt,
      confirmedAt: available.get(event.league) ?? board.fetchedAt,
      away: {name:event.away.name,score:event.status==='scheduled'?null:event.away.score},
      home: {name:event.home.name,score:event.status==='scheduled'?null:event.home.score},
    }));
  try {
    localStorage.setItem(storageKey,JSON.stringify({
      source:board.source,fetchedAt:board.fetchedAt,partial:available.size<board.leagues.length,games,
    }));
  } catch {
    // The online board still works when browser storage is restricted.
  }
}
