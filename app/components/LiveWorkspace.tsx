'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import '../live.css';
import { AccountDialog, Modal, PickPanel, PicksHistory, api, useAccount, type Selection } from './AccountPicks';
import { ActionIcon, SportIcon, StatusIcon, StarIcon, TabIcon, RefreshIcon, CloseIcon } from './SportIcon';
import { RankedTeamName, TeamMark } from './TeamMark';
import { EventDetail } from './EventDetail';
import { GolfLeaderboard } from './GolfLeaderboard';
import PwaControls from './PwaControls';
import { BoardScore, GameStatus, MatchCard } from './MatchCard';
import { SportsGlance } from './SportsGlance';
import { HelpCenter } from './HelpCenter';
import { ResponsiblePlayTools, readResponsibleLimits, isSelfExcluded, type ResponsibleLimits } from './ResponsiblePlayTools';
import { saveOfflineScoreboard } from '../lib/offline-scoreboard';
import { GameAlertSettings, GameAlertsDialog, GameMomentList, useGameAlerts, type GameMoment } from './GameUpdates';
import { ScheduleDates, scheduleDateLabel } from './ScheduleDates';
import { ScheduleTimeZone, ScheduleZoneSelect } from './ScheduleTimeZone';
import { nextScheduleDay, parseScheduleDate, parseSharedScheduleZone, resolvedScheduleZone, scheduleDay, scheduleTime, scheduleZones, type ScheduleZone } from '../lib/schedule-time';
import { BoardSearch, boardTournamentName, matchesBoardQuery, type BoardSuggestion, type Follow } from './BoardSearch';
import { useAccountFollows } from './AccountFollows';

import type { LiveBoard, LiveEvent } from '../lib/live-sports';
import { LIVE_LEAGUES } from '../lib/sports-leagues';
import { hasActiveScores, LIVE_SCORE_REFRESH_MS, SCHEDULE_REFRESH_MS } from '../lib/score-refresh';
import { pickName, pickSides, supportsDrawPick, type PickMarket, type PickSide } from '../lib/pick-outcomes';
import { consensusKey, consensusPercent } from '../lib/pick-consensus';
import { usePickConsensus } from './pick-consensus';
import { americanOdds, lineValue } from '../lib/odds';
export type { LiveEvent } from '../lib/live-sports';
// League panels fetch on mount and render nothing until data arrives, so they
// are code-split to keep the initial board bundle small.
const LeagueNews = dynamic(() => import('./LeagueNews'));
const LeagueFutures = dynamic(() => import('./LeagueFutures'));
const spotlightOptions = [
  { id: 'featured', label: 'Featured' },
  { id: 'live', label: 'Live games' },
  { id: 'soon', label: 'Starting soon' },
  { id: 'following', label: 'Following' },
] as const;
type SpotlightMode = typeof spotlightOptions[number]['id'];
export type WorkspaceView = 'board' | 'live' | 'picks' | 'preferences' | 'help';
const boardStatuses = ['all','live','upcoming','watchlist'] as const;
type BoardStatus = typeof boardStatuses[number];
type LiveScope = 'all' | 'following' | 'final';
type LiveFilters = {league: string; scope: LiveScope};
const defaultLiveFilters: LiveFilters = {league:'all',scope:'all'};
const sportCategories = [
  ['football','Football'], ['basketball','Basketball'], ['baseball','Baseball'],
  ['hockey','Hockey'], ['soccer','Soccer'], ['tennis','Tennis'], ['mma','MMA'], ['rugby','Rugby'],
  ['rugby_league','Rugby League'], ['aussierules','AFL'], ['lacrosse','Lacrosse'], ['volleyball','Volleyball'],
  ['water_polo','Water Polo'], ['field_hockey','Field Hockey'], ['golf','Golf'],
] as const;
const sportFilter = (value: string) => sportCategories.find(([key])=>value === 'sport-'+key)?.[0];

const workspacePaths: Record<WorkspaceView, string> = {board: '/', live: '/live', picks: '/picks', preferences: '/preferences', help: '/help'};

function viewFromPath(pathname: string): WorkspaceView {
  if (pathname === workspacePaths.live) return 'live';
  if (pathname === workspacePaths.picks) return 'picks';
  if (pathname === workspacePaths.preferences) return 'preferences';
  if (pathname === workspacePaths.help) return 'help';
  return 'board';
}

function readBoardStatus(params: URLSearchParams): BoardStatus {
  const values = params.getAll('status');
  return values.length === 1 ? boardStatuses.find(status => status === values[0]) ?? 'all' : 'all';
}

function readLeagueFilter(params: URLSearchParams): string {
  const leagues = params.getAll('filterLeague');
  const sports = params.getAll('filterSport');
  if (leagues.length === 1 && !sports.length && LIVE_LEAGUES.some(item=>item.id===leagues[0])) return leagues[0];
  if (!leagues.length && sports.length === 1 && sportFilter('sport-'+sports[0])) return 'sport-'+sports[0];
  return 'all';
}

function writeLeagueFilter(params: URLSearchParams, league: string) {
  params.delete('filterLeague');
  params.delete('filterSport');
  const sport = sportFilter(league);
  if (sport) params.set('filterSport',sport);
  else if (league !== 'all') params.set('filterLeague',league);
}

function readLiveFilters(params: URLSearchParams): LiveFilters {
  const scopes = params.getAll('scope');
  return {
    league: readLeagueFilter(params),
    scope: scopes.length === 1 && (scopes[0] === 'following' || scopes[0] === 'final') ? scopes[0] : 'all',
  };
}

function teamFollows(event: LiveEvent) {
  return [event.away, event.home].map(team => event.league + ':' + team.id);
}

function time(value:string) { return new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function canPick(e:LiveEvent,now:number) { return e.status==='scheduled' && new Date(e.startsAt).getTime()>now; }
function validGameLink(id: string, league: string) {
  return /^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id) && /^[a-z0-9-]{1,24}$/.test(league);
}
function readGameLink(params: URLSearchParams) {
  const id = params.get('game') ?? '';
  const league = params.get('league') ?? '';
  return params.getAll('game').length === 1 && params.getAll('league').length === 1 && validGameLink(id,league)
    ? {id,league} : null;
}
function eventKey(event: Pick<LiveEvent,'league'|'id'>) { return event.league + ':' + event.id; }

function BoardLoadingSkeleton() {
  return <section className="cw-board-skeleton" role="status" aria-label="Loading games">
    <div className="cw-skeleton-intro">
      <span className="cw-skeleton-eyebrow"><i aria-hidden="true"/> Live board</span>
      <strong>Loading the latest games</strong>
      <p>Scores and schedules are updating now.</p>
    </div>
    <span className="sr-only">Loading games…</span>
    {[0,1].map(group=><div className="cw-skeleton-group" key={group} aria-hidden="true">
      <div className="cw-skeleton-league"><i/><i/></div>
      {[0,1].map(game=><div className="cw-skeleton-game" key={game}>
        <div className="cw-skeleton-teams"><i/><i/><i/></div>
        <div className="cw-skeleton-picks"><i/><i/></div>
      </div>)}
    </div>)}
  </section>;
}

const comparisonLimit = 4;
const comparisonStorageKey = 'cowboy.liveComparison';
type ComparedGame = {event:LiveEvent; reportedAt?:string};

function comparisonTime(event: LiveEvent, board: LiveBoard | null) {
  const league = board?.leagues.find(item=>item.id===event.league);
  return (event.scoreSource ? league?.scoresUpdatedAt : league?.lastSuccessAt) ?? board?.fetchedAt;
}

function useGameMoments(board: LiveBoard | null, interrupted: boolean) {
  const previous = useRef<LiveBoard | null>(null);
  const [moments, setMoments] = useState<GameMoment[]>([]);
  useEffect(() => {
    if (!board || interrupted || (board.stale && board.leagues.every(league=>league.status === 'ok'))) {
      previous.current = null;
      return;
    }
    const last = previous.current;
    previous.current = board;
    if (!last) return;
    const lastLeagues = new Map(last.leagues.map(league=>[league.id,league]));
    const updatedLeagues = new Map<string, string>();
    for (const league of board.leagues) {
      const before = lastLeagues.get(league.id);
      if (league.status !== 'ok' || before?.status !== 'ok') continue;
      const observedAt = league.lastSuccessAt ?? board.fetchedAt;
      const previousAt = before.lastSuccessAt ?? last.fetchedAt;
      if (Date.parse(observedAt) > Date.parse(previousAt)) updatedLeagues.set(league.id,observedAt);
    }
    if (!updatedLeagues.size) return;
    const events = new Map(last.events.map(event=>[eventKey(event),event]));
    const changes = board.events.flatMap((event): GameMoment[] => {
      const key = eventKey(event);
      const before = events.get(key);
      const observedAt = updatedLeagues.get(event.league);
      if (!before || !observedAt) return [];
      let change: Pick<GameMoment,'type'|'label'> | undefined;
      if (before.status === 'scheduled' && event.status === 'live') change = {type:'start',label:'Game started'};
      else if (!before.completed && event.completed) change = {type:'final',label:'Final'};
      else if (before.status === 'live' && event.status === 'live' &&
          [event.away.score, event.home.score, ...event.away.linescores ?? [], ...event.home.linescores ?? []]
            .some(value=>value !== null) &&
          JSON.stringify([event.away.score,event.home.score,event.away.linescores,event.home.linescores]) !==
          JSON.stringify([before.away.score,before.home.score,before.away.linescores,before.home.linescores])) {
        change = {type:'score',label:'Score updated'};
      }
      return change ? [{id:key + ':' + observedAt,event,...change,observedAt}] : [];
    });
    if (changes.length) setMoments(old=>[...changes,...old]
      .sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)).slice(0,48));
  },[board,interrupted]);
  return moments;
}

function useLiveBoard() {
  const [board,setBoard]=useState<LiveBoard|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(true);
  const refresh=useRef<(league?: string)=>void>(()=>{});
  useEffect(()=>{
    let disposed=false, running=false, requestTimedOut=false, timer:ReturnType<typeof setTimeout>|undefined, requestTimer:ReturnType<typeof setTimeout>|undefined, controller:AbortController|undefined;
    const CLIENT_REQUEST_TIMEOUT_MS = 15_000;
    let delay=LIVE_SCORE_REFRESH_MS;
    let lastFullRefresh = 0;
    let lastBoard: LiveBoard | undefined;
    const load=async(league?: string, interactive = false)=>{
      if(disposed||running)return;
      const now = Date.now();
      const focused = !league && !interactive && lastBoard && hasActiveScores(lastBoard, now)
        && now - lastFullRefresh < SCHEDULE_REFRESH_MS;
      clearTimeout(timer);
      running=true;
      setBusy(true);
      controller=new AbortController();
      requestTimedOut=false;
      requestTimer=setTimeout(()=>{requestTimedOut=true;controller?.abort();}, CLIENT_REQUEST_TIMEOUT_MS);
      try {
        const url = league ? `/api/sports?${new URLSearchParams({league})}` : '/api/sports';
        const res=await fetch(url,{signal:controller.signal,cache:'no-store',
          headers: focused ? {'X-Cowboy-Score-Refresh': 'live'} : undefined});
        if(!res.ok) throw new Error('Sports source is unavailable. Please try again.');
        const data:LiveBoard=await res.json();
        if(!Array.isArray(data.events)||!Array.isArray(data.leagues))throw new Error('Sports source returned an invalid response.');
        if(!disposed){
          lastBoard = data;
          if (!league && !focused) lastFullRefresh = Date.now();
          setBoard(data);
          setError('');
          delay = Math.max(1000, data.refreshAfterMs || SCHEDULE_REFRESH_MS);
          if (focused) delay = Math.min(delay, Math.max(1000, lastFullRefresh + SCHEDULE_REFRESH_MS - Date.now()));
        }
      }catch(e){
        if(!disposed && ((e as Error).name!=='AbortError' || requestTimedOut)) {
          setError(requestTimedOut ? 'Score feed timed out. Showing the last received scores; retrying automatically.' : (e as Error).message);
        }
      }
      finally {clearTimeout(requestTimer);requestTimer=undefined;running=false;if(!disposed){setBusy(false);if(!document.hidden)timer=setTimeout(() => void load(),delay);}}
    };
    const visibility=()=>{clearTimeout(timer);if(document.hidden)controller?.abort();else void load(undefined,true);};
    refresh.current=(league)=>void load(league,true);document.addEventListener('visibilitychange',visibility);void load(undefined,true);
    return()=>{disposed=true;clearTimeout(timer);clearTimeout(requestTimer);controller?.abort();document.removeEventListener('visibilitychange',visibility);};
  },[]);
  return {board,error,busy,refresh:()=>refresh.current(),refreshLeague:(league:string)=>refresh.current(league)};
}

export default function LiveWorkspace({initialView = 'board'}: {initialView?: WorkspaceView}){
  const {board,error,busy,refresh,refreshLeague}=useLiveBoard();
  useEffect(() => { if (board && !error) saveOfflineScoreboard(board); },[board,error]);
  const moments = useGameMoments(board, Boolean(error));
  const [spotlightMode, setSpotlightMode] = useState<SpotlightMode>('featured');
  const [highlightsExpanded, setHighlightsExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [boardOptionsExpanded, setBoardOptionsExpanded] = useState(false);
  const [now,setNow]=useState(0);
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const [boardLeague,setBoardLeague]=useState('all');
  const [filter,setFilter]=useState<BoardStatus>('all');
  const [dateFilter,setDateFilter]=useState('all');
  const [preferenceZone,setPreferenceZone] = useState<ScheduleZone>('local');
  const [sharedZone,setSharedZone] = useState<string|null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cowboy.scheduleZone');
      const preference = scheduleZones.find(option => option.id === saved);
      if (preference) setPreferenceZone(preference.id);
    } catch {}
  }, []);
  const changeZone = (next: ScheduleZone) => {
    setPreferenceZone(next);
    if (dateFilter !== 'all') changeScheduleDate(dateFilter, next);
    try { localStorage.setItem('cowboy.scheduleZone',next); } catch {}
  };
  const [query,setQuery]=useState('');
  const [teamFilter,setTeamFilter]=useState<Follow|null>(null);
  const [view,setView]=useState<WorkspaceView>(initialView);
  const [liveFilters, setLiveFilters] = useState(defaultLiveFilters);
  const zone = view === 'board' && dateFilter !== 'all' && sharedZone ? sharedZone : preferenceZone;
  const liveView = view === 'live';
  const liveScope = liveFilters.scope;
  const league = liveView ? liveFilters.league : boardLeague;
  const account=useAccount();
  const [accountOpen,setAccountOpen]=useState(false);
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [selections,setSelections]=useState<Selection[]>([]);
  const [draftReady,setDraftReady]=useState(false);
  const [review,setReview]=useState(false);
  const [pending,setPending]=useState(false);
  const [pickError,setPickError]=useState('');
  const [toast,setToast]=useState('');
  const [consensusNonce,setConsensusNonce]=useState(0);
  const pickConsensus = usePickConsensus(consensusNonce);
  const [drawer,setDrawer]=useState(false);
  const [detail,setDetail]=useState<LiveEvent|null>(null);
  const [sharedGameState, setSharedGameState] = useState<'loading'|'unavailable'|null>(null);
  const sharedGameRequest = useRef<AbortController | null>(null);

  const loadGame = useCallback((id: string, league: string) => {
    sharedGameRequest.current?.abort();
    const controller = new AbortController();
    sharedGameRequest.current = controller;
    setSharedGameState('loading');
    const query = new URLSearchParams({id, league});
    api<LiveEvent | {event:LiveEvent}>(`/api/sports/event?${query}`, {signal: controller.signal})
      .then(result => {
        if (controller.signal.aborted) return;
        const event = 'event' in result ? result.event : result;
        if (event.id !== id || event.league !== league || !event.home || !event.away) {
          throw new Error('Game identity does not match link.');
        }
        setDetail(event);
        setSharedGameState(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSharedGameState('unavailable');
      });
  }, []);

  useEffect(() => {
    function readLocation() {
      sharedGameRequest.current?.abort();
      setDetail(null);
      setSharedGameState(null);
      const workspace = viewFromPath(window.location.pathname);
      setView(workspace);
      const params = new URLSearchParams(window.location.search);
      if (workspace === 'live') setLiveFilters(readLiveFilters(params));
      if (workspace === 'board') {
        const selectedLeague = readLeagueFilter(params);
        setBoardLeague(selectedLeague);
        setFilter(readBoardStatus(params));
        const date = selectedLeague === 'pga' || selectedLeague === 'sport-golf' ? 'all' : parseScheduleDate(params);
        setDateFilter(date);
        setSharedZone(date === 'all' ? null : parseSharedScheduleZone(params));
      } else {
        setDateFilter('all');
        setSharedZone(null);
      }
      if (!params.has('game') && !params.has('league')) return;
      const link = readGameLink(params);
      if (!link) {
        setSharedGameState('unavailable');
        return;
      }
      loadGame(link.id,link.league);
    }
    readLocation();
    window.addEventListener('popstate', readLocation);
    return () => {
      sharedGameRequest.current?.abort();
      window.removeEventListener('popstate', readLocation);
    };
  }, [loadGame]);

  function pushGameLocation(id: string, league: string, preserveSection = false) {
    const url = new URL(window.location.href);
    const isSwitch = url.searchParams.has('game');
    url.searchParams.set('game',id);
    url.searchParams.set('league',league);
    if (!isSwitch || !preserveSection || url.searchParams.get('section') === 'pick') {
      url.searchParams.delete('section');
    }
    // Keep a single history entry for the open Game Center, even when switching fixtures.
    if (isSwitch) window.history.replaceState({cowboyGameEntry: window.history.state?.cowboyGameEntry === true}, '', url);
    else window.history.pushState({cowboyGameEntry: true}, '', url);
  }

  function openGame(event: LiveEvent, preserveSection = false) {
    sharedGameRequest.current?.abort();
    setSharedGameState(null);
    if (validGameLink(event.id,event.league)) pushGameLocation(event.id,event.league,preserveSection);
    setDetail(event);
  }

  function openSavedGame(id: string, league: string) {
    if (!validGameLink(id,league)) {
      setSharedGameState('unavailable');
      return;
    }
    pushGameLocation(id,league);
    loadGame(id,league);
  }

  function closeGame() {
    sharedGameRequest.current?.abort();
    setSharedGameState(null);
    setDetail(null);
    const url = new URL(window.location.href);
    if (!url.searchParams.has('game') && !url.searchParams.has('league')) return;
    if (window.history.state?.cowboyGameEntry === true) {
      window.history.back();
    } else {
      url.searchParams.delete('game');
      url.searchParams.delete('league');
      url.searchParams.delete('section');
      window.history.replaceState(null, '', url);
    }
  }
  const subscriptions = useAccountFollows(account.user?.id,account.accountLoading);
  const {watched,follows,toggleWatch,toggleFollow} = subscriptions;
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem('cowboy.pickDraft.v1') || '[]');
      if (Array.isArray(value)) {
        const valid: Selection[] = value.filter(item =>
          typeof item?.event?.id === 'string' && typeof item.event.league === 'string' &&
          typeof item.event.name === 'string' && typeof item.event.leagueName === 'string' &&
          typeof item.event.home?.name === 'string' && typeof item.event.home.shortName === 'string' &&
          typeof item.event.away?.name === 'string' && typeof item.event.away.shortName === 'string' &&
          typeof item.event.startsAt === 'string' && Number.isFinite(Date.parse(item.event.startsAt)) &&
          pickSides(item.event.league, (item.market ?? 'moneyline') as PickMarket).includes(item.side) &&
          (item.market === undefined || item.market === 'moneyline' || item.market === 'spread' || item.market === 'total') &&
          typeof item.requestId === 'string');
        setSelections([...new Map(valid.map(item=>[eventKey(item.event),item])).values()].slice(0,5));
      }
    } catch {}
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (draftReady) try { sessionStorage.setItem('cowboy.pickDraft.v1', JSON.stringify(selections)); } catch {}
  }, [draftReady, selections]);

  const selectionsByGame = new Map(selections.map(pick => [eventKey(pick.event), pick]));
  const [responsibleLimits, setResponsibleLimits] = useState<ResponsibleLimits | null>(readResponsibleLimits);
  useEffect(() => {
    const handleUpdate = () => setResponsibleLimits(readResponsibleLimits());
    window.addEventListener('cowboy-responsible-update', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('cowboy-responsible-update', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);
  const selfExcluded = isSelfExcluded(responsibleLimits, now);
  const todayDateStr = now ? new Date(now).toISOString().slice(0, 10) : '';
  const todaySubmittedCount = account.tickets.filter(t => t.createdAt && t.createdAt.slice(0, 10) === todayDateStr).length;
  const dailyLimitReached = responsibleLimits !== null && (responsibleLimits.dailyPicks === 0 || todaySubmittedCount >= responsibleLimits.dailyPicks);
  const currentLeague = (id: string) => !error &&
    board?.leagues.find(league => league.id === id)?.status === 'ok';
  const eligiblePick = (event: LiveEvent | undefined) =>
    !!event && canPick(event,now) && currentLeague(event.league) && !selfExcluded;
  const draftEvents = new Map<string, LiveEvent>();
  for (const pick of selections) {
    const key = eventKey(pick.event);
    const event = board?.events.find(event => eventKey(event) === key);
    if (event && eligiblePick(event)) draftEvents.set(key,event);
  }
  const selectionDisabled = selfExcluded || dailyLimitReached || draftEvents.size !== selections.length;
  const togglePick = (event: LiveEvent, side: PickSide, market: PickMarket = 'moneyline') => {
    if (selfExcluded) {
      setToast('Picks are paused while self-exclusion is active. Check Preferences.');
      return;
    }
    if (dailyLimitReached && !selectionsByGame.has(eventKey(event))) {
      setToast(`Daily pick limit reached (${responsibleLimits.dailyPicks} picks). Check Preferences.`);
      return;
    }
    const key = eventKey(event);
    const {id,league,leagueName,name,startsAt,sport,home,away} = event;
    const pick: Selection = {event:{id,league,leagueName,name,startsAt,sport,
      home:{name:home.name,shortName:home.shortName},away:{name:away.name,shortName:away.shortName}},
      side,...(market !== 'moneyline' ? {market} : {}),requestId:crypto.randomUUID()};
    setSelections(previous => {
      const selected = previous.find(item => eventKey(item.event) === key);
      if (!selected) return previous.length < 5 ? [...previous,pick] : previous;
      return selected.side === side && (selected.market ?? 'moneyline') === market
        ? previous.filter(item => item !== selected)
        : previous.map(item => item === selected ? pick : item);
    });
    setPickError('');
  };
  const rebet = (ticket: {side: PickSide; market?: PickMarket}, event: LiveEvent) => {
    if (selfExcluded) {
      setToast('Picks are paused while self-exclusion is active. Check Preferences.');
      return;
    }
    if (dailyLimitReached && !selectionsByGame.has(eventKey(event))) {
      setToast(`Daily pick limit reached (${responsibleLimits.dailyPicks} picks). Check Preferences.`);
      return;
    }
    if (!eligiblePick(event)) return;
    togglePick(event, ticket.side, ticket.market ?? 'moneyline');
    openBoard();
    setToast('Pick restored to your draft. Review it before saving.');
  };
  const submitPick = async () => {
    if (!selections.length || pending || selectionDisabled) return;
    setPending(true);
    setPickError('');
    try {
      const picks = selections.map(({event,side,market,requestId}) => ({eventId:event.id,league:event.league,side,...(market ? {market} : {}),requestId}));
      await api(picks.length === 1 ? '/api/picks' : '/api/picks/batch', {
        method:'POST',body:JSON.stringify(picks.length === 1 ? picks[0] : {picks}),
      });
      await account.loadTickets();
      setConsensusNonce(nonce => nonce + 1);
      setSelections([]);
      setReview(false);
      setDrawer(false);
      setToast(picks.length === 1 ? 'Free pick saved. Follow it in My picks.' : `${picks.length} free picks saved. Follow them in My picks.`);
    } catch (error) {
      setPickError((error as Error).message);
    } finally {
      setPending(false);
    }
  };
  const pickPanel = <PickPanel selections={selections} user={account.user} disabled={selectionDisabled} pending={pending}
    onReview={()=>{setReview(true);setDrawer(false);}}
    draftEvents={draftEvents} onChoose={togglePick} onClear={()=>setSelections([])}
    onRemove={pick=>setSelections(previous=>previous.filter(item=>item.requestId!==pick.requestId))}
    onSignIn={()=>{setAccountOpen(true);setDrawer(false);}}/>;
  const todayKey = scheduleDay(now,zone);
  const tomorrowKey = nextScheduleDay(todayKey);
  const dateName = scheduleDateLabel(dateFilter,todayKey,tomorrowKey);
  const preferencesView = view === 'preferences';
  const helpView = view === 'help';
  const informationView = preferencesView || helpView;
  const pageHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (informationView && !window.location.hash) {
      pageHeading.current?.focus({preventScroll:true});
      window.scrollTo({top:0,behavior:'instant'});
    }
  }, [informationView, view]);
  function navigate(next: WorkspaceView) {
    const path = workspacePaths[next];
    if (window.location.pathname !== path) {
      sharedGameRequest.current?.abort();
      setDetail(null);
      setSharedGameState(null);
      window.history.pushState(null,'',path);
    }
    setView(next);
  }
  const openBoard = () => { clearTransientFilters(); navigate('board'); replaceBoardLeague('all'); changeScheduleDate('all'); replaceBoardStatus('all'); };
  const openWatchlist = () => { openBoard(); replaceBoardStatus('watchlist'); };
  const openLive = () => { clearTransientFilters(); navigate('live'); replaceLiveFilters(defaultLiveFilters); };
  const openPicks = () => navigate('picks');
  const [compared,setCompared] = useState<ComparedGame[]>([]);
  const restoredComparison = useRef(false);
  const allEvents = board?.events ?? [];
  const comparedKeys = new Set(compared.map(item=>eventKey(item.event)));
  useEffect(()=>{
    if (!board) return;
    const games = new Map(board.events.map(event=>[eventKey(event),event]));
    if (!restoredComparison.current) {
      restoredComparison.current = true;
      try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(comparisonStorageKey) ?? '[]');
        if (Array.isArray(saved)) {
          const selected = [...new Set(saved.slice(0,comparisonLimit))].flatMap(key=>{
            const event = typeof key === 'string' ? games.get(key) : undefined;
            return event ? [{event,reportedAt:comparisonTime(event,board)}] : [];
          });
          if (selected.length) setCompared(previous=>previous.length ? previous : selected);
        }
      } catch {}
      return;
    }
    setCompared(previous=>previous.length ? previous.map(item=>{
      const latest = games.get(eventKey(item.event));
      return latest ? {event:latest,reportedAt:comparisonTime(latest,board)} : item;
    }) : previous);
  },[board]);

  function toggleComparison(event: LiveEvent) {
    const key = eventKey(event);
    if (compared.length>=comparisonLimit && !comparedKeys.has(key)) return;
    const next = comparedKeys.has(key)
      ? compared.filter(item=>eventKey(item.event)!==key)
      : [...compared,{event,reportedAt:comparisonTime(event,board)}];
    setCompared(next);
    try { sessionStorage.setItem(comparisonStorageKey,JSON.stringify(next.map(item=>eventKey(item.event)))); } catch {}
  }

  const liveEvents = allEvents.filter(event => event.status === 'live');
  const finalEvents = allEvents.filter(event => event.completed);
  const watchedIds = new Set(watched);
  const followedIds = new Set(follows.map(item=>item.id));
  const isWatched = (event: LiveEvent) => watchedIds.has(`${event.league}:${event.id}`);
  const isFollowed = (event: LiveEvent) => isWatched(event) || followedIds.has(event.league) ||
    teamFollows(event).some(id=>followedIds.has(id));
  const scheduledFollows = allEvents.filter(event => eligiblePick(event) && isFollowed(event));
  const alerts = useGameAlerts(moments.filter(moment=>isFollowed(moment.event)),scheduledFollows,now);
  const unreadAlerts = alerts.quiet ? 0 : alerts.unread;
  const openMoment = (event: LiveEvent) =>
    openGame(allEvents.find(item=>eventKey(item)===eventKey(event)) ?? event);
  const followedLive = liveEvents.filter(isFollowed);
  const golfView = league === 'pga' || league === 'sport-golf';
  const allGolf = board?.golf ?? [];
  const liveGolf = allGolf.filter(event => event.state === 'in');
  const finalGolf = allGolf.filter(event => event.completed);
  const followedGolf = followedIds.has('pga') ? liveGolf : [];
  const golfEvents = liveView ? {all:liveGolf, following:followedGolf, final:finalGolf}[liveScope] : allGolf;
  const leagueEvents = liveView
    ? {all: liveEvents, following: followedLive, final: finalEvents}[liveScope]
    : allEvents;
  const selectedSport = sportFilter(league);
  const inSelectedLeague = (event: LiveEvent) =>
    selectedSport ? event.sport === selectedSport : league === 'all' || event.league === league;
  const matchesSelection = (event: LiveEvent) => inSelectedLeague(event) &&
    (!teamFilter || teamFollows(event).includes(teamFilter.id)) && matchesBoardQuery(event, query);
  const matchingEvents = leagueEvents.filter(event => {
    if (!liveView && filter === 'watchlist' && !isFollowed(event)) return false;
    if (!liveView && filter === 'live' && event.status !== 'live') return false;
    if (!liveView && filter === 'upcoming' && !canPick(event, now)) return false;
    return matchesSelection(event);
  });
  const visibleMoments = liveView ? moments.filter(moment =>
    matchesSelection(moment.event) &&
    (liveScope !== 'following' || isFollowed(moment.event)) &&
    (liveScope !== 'final' || moment.type === 'final'),
  ) : [];
  const dateCounts = new Map<string, number>();
  if (!liveView && !golfView) {
    for (const event of matchingEvents) {
      const day = scheduleDay(event.startsAt,zone);
      if (day) dateCounts.set(day, (dateCounts.get(day) ?? 0) + 1);
    }
  }
  const events = liveView || dateFilter === 'all'
    ? matchingEvents : matchingEvents.filter(event => scheduleDay(event.startsAt,zone) === dateFilter);
  const [sort,setSort]=useState('status');
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const [showAllGroups,setShowAllGroups]=useState<string[]>([]);
  const [showFullBoard,setShowFullBoard]=useState(false);
  function replaceLiveFilters(next: LiveFilters) {
    const url = new URL(window.location.href);
    writeLeagueFilter(url.searchParams,next.league);
    if (next.scope === 'all') url.searchParams.delete('scope');
    else url.searchParams.set('scope',next.scope);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state,'',url);
    setLiveFilters(next);
  }
  function replaceBoardStatus(status: BoardStatus) {
    const url = new URL(window.location.href);
    if (viewFromPath(url.pathname) === 'board') {
      if (status === 'all') url.searchParams.delete('status');
      else url.searchParams.set('status',status);
      if (url.href !== window.location.href) window.history.replaceState(window.history.state,'',url);
    }
    setFilter(status);
  }

  function replaceBoardLeague(league: string) {
    const url = new URL(window.location.href);
    writeLeagueFilter(url.searchParams,league);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state,'',url);
    setBoardLeague(league);
  }

  function changeScheduleDate(date: string, selectedZone = zone) {
    const url = new URL(window.location.href);
    if (viewFromPath(url.pathname) !== 'board') return;
    const nextZone = date === 'all' ? null : resolvedScheduleZone(selectedZone);
    if (date === 'all') url.searchParams.delete('date');
    else url.searchParams.set('date', date);
    if (nextZone) url.searchParams.set('tz', nextZone);
    else url.searchParams.delete('tz');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state,'',url);
    setDateFilter(date);
    setSharedZone(nextZone);
  }

  function selectWorkspaceLeague(id: string) {
    if (liveView) replaceLiveFilters({...liveFilters,league:id});
    else {
      replaceBoardLeague(id);
      if (id === 'pga' || id === 'sport-golf') changeScheduleDate('all');
    }
  }
  function clearTransientFilters() {
    setTeamFilter(null);setFilter('all');setDateFilter('all');setQuery('');setCollapsed([]);setShowAllGroups([]);setShowFullBoard(false);
  }
  function resetFilters() {
    selectWorkspaceLeague('all');
    clearTransientFilters();
    if (!liveView) replaceBoardStatus('all');
    changeScheduleDate('all');
  }
  function selectLeague(id: string) {
    if (view==='picks') openBoard();
    setTeamFilter(null);
    selectWorkspaceLeague(id);
  }
  function selectSuggestion(item: BoardSuggestion) {
    if (item.kind==='game') {
      openGame(item.event);
      return;
    }
    clearTransientFilters();
    if (!liveView) replaceBoardStatus('all');
    changeScheduleDate('all');
    selectWorkspaceLeague(item.kind==='league' ? item.id : item.league);
    if (item.kind==='team') setTeamFilter({id:item.id,name:item.name,league:item.league});
    if (item.kind==='tournament') setQuery(item.name);
    document.getElementById('games-board')?.focus();
  }
  const ranked=[...events].sort((a,b)=>{
    const priority=(e:LiveEvent)=>e.status==='live'?0:canPick(e,now)?1:2;
    if (liveView && liveScope === 'final' && sort === 'status') return Date.parse(b.startsAt) - Date.parse(a.startsAt);
    return (sort==='status'?priority(a)-priority(b):0)||Date.parse(a.startsAt)-Date.parse(b.startsAt);
  });
  const groups=(board?.leagues||[]).flatMap(item=>{
    const groups = new Map<string,{id:string;leagueId:string;name:string;sport:string;events:LiveEvent[]}>();
    for (const event of ranked.filter(event=>event.league===item.id)) {
      const tournament = event.sport === 'tennis' ? boardTournamentName(event) : undefined;
      const id = event.fight ? `ufc:${event.fight.cardId}` : tournament ? `${item.id}:tournament:${tournament}` : item.id;
      let group = groups.get(id);
      if (!group) {
        group = {id,leagueId:item.id,name:event.fight?.cardName ?? tournament ?? item.name,sport:item.sport,events:[]};
        groups.set(id,group);
      }
      group.events.push(event);
    }
    return [...groups.values()];
  });
  const liveScorecards = liveView && liveScope !== 'final' ? ranked.slice(0, 6) : [];
  const onHome = view === 'board' && league === 'all' && filter === 'all' && dateFilter === 'all' && !query && !teamFilter;
  const homeGroupRank = (group: typeof groups[number]) => {
    if (group.events.some(event=>event.status==='live')) return 0;
    if (group.events.some(event=>canPick(event,now))) return 1;
    return 2;
  };
  const homeGroupStart = (group: typeof groups[number]) => Math.min(...group.events.map(event=>Date.parse(event.startsAt)));
  const curatedHome = onHome && groups.length > 8;
  const curatedGroups = onHome ? [...groups].sort((a,b)=>homeGroupRank(a)-homeGroupRank(b) ||
    homeGroupStart(a)-homeGroupStart(b)).slice(0,6) : groups;
  const displayedGroups = curatedHome && !showFullBoard ? curatedGroups : groups;
  const homeGroupLimit = curatedHome && !showFullBoard ? 2 : 5;
  const upcomingOrder = (a: LiveEvent,b: LiveEvent) => Date.parse(a.startsAt) - Date.parse(b.startsAt);
  const followedGame = onHome ? followedLive[0] ?? scheduledFollows.slice().sort(upcomingOrder)[0] ??
    finalEvents.filter(isFollowed).sort((a,b)=>upcomingOrder(b,a))[0] : undefined;
  const glanceGame = onHome ? followedGame ?? liveEvents[0] ?? allEvents.filter(event=>eligiblePick(event)).sort(upcomingOrder)[0] : undefined;
  const spotlightCandidates=events.filter(event=>event.status==='live'||canPick(event,now));
  const spotlight=spotlightCandidates.filter(event=>{
    if (spotlightMode==='live') return event.status==='live';
    if (spotlightMode==='soon') return event.status==='scheduled' && Date.parse(event.startsAt)-now<=2*60*60*1000;
    if (spotlightMode==='following') return isFollowed(event);
    return !glanceGame || eventKey(event) !== eventKey(glanceGame);
  }).sort((a,b)=>Number(b.status==='live')-Number(a.status==='live') ||
    Number(isFollowed(b))-Number(isFollowed(a)) || Date.parse(a.startsAt)-Date.parse(b.startsAt)).slice(0,6);
  const spotlightEmpty = {
    featured:'No featured games for these filters.',
    live:'No live games for these filters.',
    soon:'No games starting in the next two hours.',
    following:'No live or upcoming games from your follows for these filters.',
  }[spotlightMode];
  const leagueCounts = new Map<string, number>();
  for (const event of leagueEvents) leagueCounts.set(event.league, (leagueCounts.get(event.league) ?? 0) + 1);
  const availableLeagues = board?.leagues ?? [];
  const leagueMeta = new Map(availableLeagues.map(item=>[item.id,item]));
  const ageText = (iso: string | undefined) => {
    if (!iso) return null;
    const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (!Number.isFinite(seconds)) return null;
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };
  const leagueFreshness = (leagueId: string) => {
    const meta = leagueMeta.get(leagueId);
    if (!meta || meta.status === 'ok') return null;
    const stamp = meta.scoresUpdatedAt ?? meta.lastSuccessAt;
    const age = ageText(stamp);
    const state = meta.status === 'error' ? 'Unavailable' : meta.backupSource ? 'Backup feed' : 'Delayed';
    return `${state}${age ? ` · ${age} ago` : ''}`;
  };
  const eventUpdated = (event: LiveEvent) => {
    if (event.status !== 'live') return null;
    const meta = leagueMeta.get(event.league);
    const age = ageText(meta?.scoresUpdatedAt ?? meta?.lastSuccessAt);
    return age ? `updated ${age} ago` : null;
  };
  const deviceFollows = view === 'board' && filter === 'watchlist' ? subscriptions.importable(allEvents,availableLeagues) : [];
  const pickedLeague = availableLeagues.find(item=>item.id===league);
  const leagueSport = selectedSport ?? pickedLeague?.sport;
  const sportLabel = sportCategories.find(([sport])=>sport===leagueSport)?.[1];
  const sidebarLeagues = availableLeagues.filter(item=>!leagueSport || item.sport===leagueSport).sort((a,b)=>
    Number(followedIds.has(b.id))-Number(followedIds.has(a.id)) ||
    (liveView ? (leagueCounts.get(b.id) ?? 0)-(leagueCounts.get(a.id) ?? 0) : 0));
  const leagueRail = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = leagueRail.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const selected = rail.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!selected) return;
    const left = selected.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    if (left < 0 || left + selected.offsetWidth > rail.clientWidth) {
      rail.scrollLeft += left - (rail.clientWidth - selected.offsetWidth) / 2;
    }
  }, [league, board !== null]);
  const boardFollow = teamFilter ?? (pickedLeague ? {id:pickedLeague.id,name:pickedLeague.name,league:pickedLeague.id} : null);
  const live = liveEvents.length;
  const feedHealth = board ? board.leagues.reduce((stats, item) => {
    if (item.status === 'ok') stats.healthy += 1;
    else if (item.status === 'stale') stats.delayed += 1;
    else stats.failed += 1;
    if (item.backupSource) stats.fallbacks += 1;
    return stats;
  }, {healthy: 0, delayed: 0, failed: 0, fallbacks: 0}) : null;
  const feedSummary = feedHealth
    ? `${feedHealth.healthy}/${board?.leagues.length ?? 0} feeds healthy`
    : 'Connecting to score feeds';
  const liveScopes = ([
    { key: 'all', label: 'In progress', events: liveEvents, golf: liveGolf },
    { key: 'following', label: 'Following', events: followedLive, golf: followedGolf },
    { key: 'final', label: 'Recent finals', events: finalEvents, golf: finalGolf },
  ] as const).map(scope => ({
    key: scope.key,
    label: scope.label,
    count: golfView ? scope.golf.length : scope.events.filter(inSelectedLeague).length,
  }));
  const selectedLiveCount = liveScopes[0].count;
  const liveScopeLabel = liveScopes.find(scope => scope.key === liveScope)?.label;
  const liveEmpty = {
    all: ['No live games in this view', 'Try another league or search, or check recent finals.'],
    following: ['No followed games are live', 'Follow a game, team or league to see its live games here.'],
    final: ['No finals in this view', 'Try another league or search.'],
  }[liveScope];
  const upcoming = (board?.events ?? []).some(event => canPick(event, now));
  const showSpotlight = spotlightCandidates.length > 0 && (spotlightMode !== 'featured' || spotlight.length > 0);
  const showHighlights = view === 'board' && league === 'all' && ((onHome && !!board) || showSpotlight);
  const openUpcoming = () => {
    resetFilters();
    replaceBoardStatus('upcoming');
    document.getElementById('games-board')?.scrollIntoView({block: 'start'});
  };
  const detailBoardEvent = detail ? allEvents.find(event => eventKey(event) === eventKey(detail)) : undefined;
  const detailLeague = detail ? board?.leagues.find(league => league.id === detail.league) : undefined;
  const detailTicket = detail && account.user
    ? account.tickets.find(ticket => ticket.eventId === detail.id && ticket.league === detail.league && ticket.status !== 'cancelled')
    : undefined;
  const failedGame = sharedGameState === 'unavailable'
    ? readGameLink(new URLSearchParams(window.location.search)) : null;
  const savedPick = failedGame && view === 'picks' && account.user
    ? account.tickets.find(ticket => ticket.eventId === failedGame.id && ticket.league === failedGame.league)
    : undefined;
  return <ScheduleTimeZone.Provider value={zone}><div className={`cowboy-live ${liveView ? "cw-live-page" : informationView ? "cw-information-page" : view === "picks" ? "cw-picks-page" : "cw-home-page"}`}>
    <header className="cw-header"><a className="cw-brand" href="/" aria-label="COWBOY home"><img src="/cowboy-mark.webp" alt=""/><span>COWBOY<small>SPORTS / FREE PICKS</small></span></a><nav aria-label="Main navigation"><button aria-pressed={view==='board'} onClick={openBoard}><SportIcon sport="all"/>Sports board</button><button aria-pressed={liveView} onClick={openLive}><StatusIcon status="live"/>Live</button><button aria-pressed={view==='picks'} onClick={openPicks}><ActionIcon action="picks"/>My picks</button></nav><div className="cw-header-actions">
      <button className="cw-updates-button" onClick={()=>setAlertsOpen(true)}
        aria-label={unreadAlerts ? `Game updates, ${unreadAlerts} unread` : 'Game updates'}>
        <ActionIcon action="alerts"/>Updates {unreadAlerts > 0 && <span aria-hidden="true">{unreadAlerts}</span>}
      </button><button className="cw-account" disabled={account.accountLoading} aria-label={account.user?`Account: ${account.user.username}`:undefined} onClick={()=>setAccountOpen(true)}><ActionIcon action="account"/>{account.accountLoading?'Checking session…':account.user?account.user.username:'Sign in'}</button></div></header>
    <div className="cw-source"><span><i className={error||board?.stale?'warning-dot':'source-dot live-radar'}/><b>Scores</b> <span>{error?'Connection interrupted':board?.stale?'Delayed data':!board?'Syncing scores…':'Connected'}</span></span><span className="cw-source-right"><span>{board?`${error || board.stale ? 'Last received' : 'Updated'} ${new Date(board.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'Connecting…'}</span><button className="cw-source-refresh" disabled={busy} onClick={refresh} aria-label="Refresh sports"><RefreshIcon/></button><button className="cw-source-health-toggle" aria-expanded={sourcesExpanded} aria-controls="cw-source-health" onClick={()=>setSourcesExpanded(value=>!value)}>{feedSummary}<span aria-hidden="true">{sourcesExpanded?'−':'+'}</span></button></span></div>
    {sourcesExpanded && <section className="cw-source-health" id="cw-source-health" aria-label="Score feed health">
      <div className="cw-source-health-head"><div><strong>Feed health</strong><span>Live updates combine verified feeds and automatic backups. Delays are labeled.</span></div><span>{feedHealth ? `${feedHealth.failed ? `${feedHealth.failed} unavailable` : 'No failures'}${feedHealth.delayed ? ` · ${feedHealth.delayed} delayed` : ''}` : 'Waiting for first response'}</span></div>
      <div className="cw-source-health-grid">{board?.leagues.map(item=><button key={item.id} className={`cw-source-health-item ${item.status}`} onClick={()=>{setSourcesExpanded(false);selectLeague(item.id)}}><span><SportIcon sport={item.sport}/>{item.name}</span><small>{item.status==='ok'?'Live updates':item.backupSource?'Backup updates':item.status==='stale'?'Delayed updates':'Unavailable'}</small></button>)}</div>
    </section>}
    <div className="cw-grid">
    {!informationView && <aside className="cw-sports">
      <p className="cw-kicker">{liveView ? 'Live by league' : 'Browse by league'}</p>
      <nav aria-label="Leagues" ref={leagueRail}>
        <button aria-pressed={league==='all'} onClick={()=>selectLeague('all')}>
          <SportIcon sport="all"/>{liveView ? 'All leagues' : 'All sports'} <small aria-hidden="true">{leagueEvents.length}</small>
        </button>
        {sportLabel && leagueSport && leagueSport!=='golf' &&
          <button aria-label={`All ${sportLabel}`} aria-pressed={!!selectedSport} onClick={()=>selectLeague('sport-'+leagueSport)}>
            <SportIcon sport={leagueSport}/>All {sportLabel}
            <small aria-hidden="true">{sidebarLeagues.reduce((total,item)=>total+(leagueCounts.get(item.id)??0),0)}</small>
          </button>}
        {sidebarLeagues.map(item => (
          <button key={item.id} aria-label={item.name} aria-pressed={league===item.id}
            onClick={()=>selectLeague(item.id)}>
            <SportIcon sport={item.sport}/>{item.name}
            {followedIds.has(item.id) && <StarIcon filled/>}
            <small aria-hidden="true">{item.status==='error'?'!':item.id==='pga'?golfEvents.length:leagueCounts.get(item.id)??0}</small>
          </button>
        ))}
      </nav>
    </aside>}
    <main className="cw-main">
      <div className="cw-title">
        <h1 ref={informationView ? pageHeading : undefined} tabIndex={informationView ? -1 : undefined}>
          {liveView?'Live board':view==='board'?(filter === 'watchlist' ? 'Watchlist' : 'Sports board'):preferencesView?'Preferences':helpView?'Help & rules':'My picks'}
        </h1>
        {view==='board'&&(!onHome||!board)&&<button className="cw-live-count" onClick={openLive}>{live} live games <span aria-hidden="true">→</span></button>}
        {showHighlights&&<button className="cw-highlights-toggle" type="button" aria-expanded={highlightsExpanded}
          aria-controls="cw-board-highlights" onClick={()=>setHighlightsExpanded(value=>!value)}>
          Highlights <span aria-hidden="true">{highlightsExpanded?'−':'+'}</span>
        </button>}
        {liveView&&<span className="cw-live-count">{selectedLiveCount} live{error||board?.stale?' · Last received':''}</span>}
      </div>
      {!informationView && view !== 'picks' && board && <nav className="cw-sport-categories" aria-label="Sports">
        <button aria-pressed={league==='all'} onClick={()=>selectLeague('all')}> <SportIcon sport="all"/>All</button>
        {sportCategories.filter(([sport])=>availableLeagues.some(item=>item.sport===sport)).map(([sport,label])=>
          <button key={sport} aria-pressed={(selectedSport ?? pickedLeague?.sport)===sport}
            onClick={()=>selectLeague(sport==='golf' ? 'pga' : 'sport-'+sport)}>
            <SportIcon sport={sport}/>{label}
          </button>
        )}
      </nav>}
      {account.accountError&&<p className="cw-alert" role="alert">{account.accountError}</p>}
      {helpView ? <HelpCenter/> : preferencesView ? <div className="cw-preferences">
        <p>Schedule and update preferences apply to this browser.</p>
        <section aria-labelledby="cw-pref-schedule">
          <h2 id="cw-pref-schedule">Schedule</h2>
          <p>Display kickoff times and group games by date in this timezone.</p>
          <ScheduleZoneSelect value={preferenceZone} onChange={changeZone}/>
        </section>
        <section aria-labelledby="cw-pref-updates">
          <h2 id="cw-pref-updates">Followed game updates</h2>
          <p>Choose which updates appear while COWBOY is open.</p>
          <GameAlertSettings alerts={alerts}/>
        </section>
        <section aria-labelledby="cw-pref-account">
          <h2 id="cw-pref-account">Account</h2>
          <p>Manage your signed-in sessions and data.</p>
          <button onClick={()=>setAccountOpen(true)}>{account.user ? 'Manage account' : 'Open account settings'}</button>
        </section>
        <ResponsiblePlayTools onChange={setResponsibleLimits}/>
      </div> : view!=='picks'?<>
      {liveView && <div className="cw-live-switcher" role="group" aria-label="Live board views">
        {liveScopes.map(scope => (
          <button key={scope.key} aria-pressed={scope.key === liveScope} onClick={() => {
            clearTransientFilters();
            setSort('status');
            replaceLiveFilters({...liveFilters,scope:scope.key});
          }}>
            <span><TabIcon tab={scope.key === 'all' ? 'live' : scope.key}/>{scope.label}</span><strong>{scope.count}</strong>
          </button>
        ))}
      </div>}
      {liveView && compared.length > 0 && <section className="cw-live-comparison" id="cw-score-comparison" tabIndex={-1} aria-label="Score comparison">
        <div className="cw-section-heading">
          <h2>Score comparison</h2>
          <span aria-live="polite">{compared.length} of {comparisonLimit} games</span>
        </div>
        <div className="cw-comparison-grid">
          {compared.map(({event,reportedAt})=>{
            const key = eventKey(event);
            const current = allEvents.find(item=>eventKey(item)===key);
            const league = board?.leagues.find(item=>item.id===event.league);
            const delayed = !!error || !current || league?.status !== 'ok';
            return <article key={key} className="cw-comparison-card" aria-label={event.name}>
              <MatchCard event={event} onOpen={openGame} label={`Open compared game: ${event.name}`}/>
              <div className="cw-comparison-meta">
                <span>{delayed ? event.scoreSource ? 'Backup score' : 'Last reported' : 'Updated'}
                  {reportedAt && <> <time dateTime={reportedAt}>{time(reportedAt)}</time></>}</span>
                <button onClick={()=>{
                  toggleComparison(event);
                  (document.getElementById('cw-compare-'+key) ?? document.getElementById('games-board'))?.focus();
                }} aria-label={`Remove ${event.name} from comparison`}>Remove</button>
              </div>
            </article>;
          })}
        </div>
      </section>}
      {liveScorecards.length > 0 && <section className="cw-live-scorecards" aria-label="Live scores">
        <div className="cw-section-heading">
          <h2>Live scores</h2>
          <span>{error || board?.stale ? 'Last received' : 'Updated'} <time dateTime={board?.fetchedAt}>{board && time(board.fetchedAt)}</time></span>
        </div>
        <div className="cw-match-shelf">
          {liveScorecards.map(event => <MatchCard key={eventKey(event)} event={event} onOpen={openGame}/>)}
        </div>
      </section>}
      {showHighlights && <div id="cw-board-highlights" data-expanded={highlightsExpanded}>
          {onHome && board && <SportsGlance event={glanceGame} personalized={!!followedGame} liveCount={live}
            followedLiveCount={followedLive.length} fetchedAt={board.fetchedAt} delayed={!!error||board.stale}
            onOpen={openGame} onWatchlist={openWatchlist} onLive={openLive}/>}
          {showSpotlight && (
            <section className="cw-spotlight" aria-label="In the spotlight">
              <div className="cw-section-heading">
                <h2>Featured games</h2>
                {upcoming&&<button className="cw-upcoming-jump" onClick={openUpcoming} aria-pressed={filter==='upcoming'}>
                  Browse upcoming <span aria-hidden="true">→</span>
                </button>}
              </div>
              <div className="cw-spotlight-options" role="group" aria-label="Featured game views">
                {spotlightOptions.map(option=><button key={option.id} aria-pressed={spotlightMode===option.id}
                  onClick={()=>setSpotlightMode(option.id)}><TabIcon tab={option.id === 'soon' ? 'upcoming' : option.id}/>{option.label}</button>)}
              </div>
              {board && <p className="cw-spotlight-source">{error || board.stale ? 'Last received' : 'Updated'} {time(board.fetchedAt)}</p>}
              {!spotlight.length && <p className="cw-spotlight-empty">{spotlightEmpty}</p>}
              <div className="cw-match-shelf">
                {spotlight.map(e => (
                  <MatchCard key={eventKey(e)} event={e} onOpen={openGame}/>
                ))}
              </div>
            </section>
          )}
      </div>}
      {!liveView && !golfView && now > 0 && <ScheduleDates value={dateFilter} counts={dateCounts}
        today={todayKey} tomorrow={tomorrowKey} onChange={changeScheduleDate}/>}
      {!golfView && <div className="cw-toolbar">
        {!liveView && <div role="group" aria-label="Event status">
          {boardStatuses.map(f=><button key={f} aria-pressed={filter===f}
            onClick={()=>f==='watchlist' ? openWatchlist() : replaceBoardStatus(f)}>
            <TabIcon tab={f}/>{f==='all' ? 'All games' : f==='live' ? 'Live now' : f==='watchlist' ? 'Watchlist' : 'Upcoming'}
          </button>)}
        </div>}
        <BoardSearch events={leagueEvents} leagues={availableLeagues} query={query} onChange={setQuery} onSelect={selectSuggestion}/>
      </div>}
      {!liveView && filter==='watchlist' && deviceFollows.length > 0 && <div className="cw-follow-list">
        <button disabled={subscriptions.disabled} onClick={()=>void subscriptions.save(deviceFollows,true)}>
          {subscriptions.saving ? 'Importing follows…' : 'Import device follows'}
        </button>
      </div>}
      {subscriptions.error && <div className="cw-alert" role="alert">
        Watchlist sync: {subscriptions.error}
        <button disabled={subscriptions.saving} onClick={()=>void subscriptions.refresh()}>Retry watchlist sync</button>
      </div>}
      {!liveView && filter==='watchlist' && follows.length > 0 && <div className="cw-follow-list" aria-label="Followed teams and leagues">
        {follows.map(item=><button key={item.id} aria-label={`Unfollow ${item.name}`} disabled={subscriptions.disabled} onClick={()=>toggleFollow(item)}>
          <StarIcon filled/>{item.name}<CloseIcon/>
        </button>)}
      </div>}
      {error&&<div className="cw-alert" role="alert">Could not refresh scores. {board&&'Last received games are shown; new picks are paused.'}<button disabled={busy} onClick={refresh}>Try again</button></div>}
      {board?.stale&&<div className="cw-alert" role="status">Score updates are delayed. Affected leagues show backup or last received scores, and new picks are paused.</div>}
      {board?.leagues.filter(l=>l.status!=='ok').map(l=><div className="cw-league-error cw-league-health" key={l.id}>
        <div>
          <span>{l.name}: {l.backupSource?'backup scores':l.status==='error'?'scores unavailable':'delayed'}</span>
          {l.scoresUpdatedAt && <small>Backup checked <time dateTime={l.scoresUpdatedAt}>{time(l.scoresUpdatedAt)}</time></small>}
          {l.lastSuccessAt && <small>Last primary update <time dateTime={l.lastSuccessAt}>{time(l.lastSuccessAt)}</time></small>}
        </div>
        <button disabled={busy} onClick={()=>refreshLeague(l.id)} aria-label={`Retry ${l.name} feed`}>Retry</button>
      </div>)}
      <div className="cw-board-meta" id="games-board" tabIndex={-1} data-options-expanded={boardOptionsExpanded}>
        <div className="cw-board-context">
          <h2>{teamFilter?.name ?? pickedLeague?.name ?? sportLabel ?? (liveView ? liveScopeLabel : 'Around the leagues')}
            {!liveView && !golfView && <small className="cw-board-date">{dateName}</small>}
          </h2>
          {liveView && compared.length > 0 && <button className="cw-compare-jump"
            onClick={()=>document.getElementById('cw-score-comparison')?.focus()}><ActionIcon action="compare"/>View comparison</button>}
          {pickedLeague?.status === 'ok' && pickedLeague.lastSuccessAt && <span className="cw-league-updated">Updated <time dateTime={pickedLeague.lastSuccessAt}>{time(pickedLeague.lastSuccessAt)}</time></span>}
          {boardFollow && <button className="cw-board-follow" disabled={subscriptions.disabled} aria-pressed={followedIds.has(boardFollow.id)}
            aria-label={`${followedIds.has(boardFollow.id) ? 'Unfollow' : 'Follow'} ${boardFollow.name}`}
            onClick={()=>toggleFollow(boardFollow)}><StarIcon filled={followedIds.has(boardFollow.id)}/>
            {followedIds.has(boardFollow.id) ? 'Following' : 'Follow'}
          </button>}
        </div>
        <div className="cw-board-controls">
          <span aria-live="polite">{golfView ? `${golfEvents.length} tournaments` : curatedHome&&!showFullBoard ? `Featured from ${events.length} games` : `${events.length} games`}</span>
          {!liveView && <button type="button" className="cw-board-options-toggle" aria-expanded={boardOptionsExpanded}
            aria-controls="cw-board-options" onClick={()=>setBoardOptionsExpanded(value=>!value)}>
            {golfView ? 'Timezone' : 'Sort & timezone'}
          </button>}
          <div className="cw-board-options" id="cw-board-options">
            <ScheduleZoneSelect value={zone} onChange={changeZone}/>
            {!golfView && <label><span className="sr-only">Sort games</span><select value={sort} onChange={e=>setSort(e.target.value)}>
              <option value="status">{liveView ? (liveScope==='final'?'Most recent':'Board order') : 'Live & upcoming first'}</option>
              <option value="start">Start time</option>
            </select></label>}
          </div>
          {(query||(!liveView&&filter!=='all')||league!=='all'||dateFilter!=='all')&&<button onClick={resetFilters}>Clear filters</button>}
        </div>
      </div>
      {view==='board' && !liveView && pickedLeague && <><LeagueNews league={pickedLeague.id} name={pickedLeague.name}/><LeagueFutures league={pickedLeague.id} name={pickedLeague.name}/></>}
      {golfView ? <GolfLeaderboard events={golfEvents}/> : !board&&busy?<BoardLoadingSkeleton/>:events.length===0?<div className="cw-empty"><h3>{error?'No games available':liveView?liveEmpty[0]:'No games in this view'}</h3><p>{error?'Refresh the sports feed to try again.':liveView?liveEmpty[1]:filter==='watchlist'?'Follow a team or league, or star a game to add it here.':dateFilter!=='all'?'Choose another schedule date or clear the filters.':'Try another league, status, or search.'}</p></div>:<section className="cw-events" aria-label="Games"><div className="cw-event-head"><span>EVENT / SCORE</span>{!liveView&&<span>FREE WINNER PICK</span>}</div>{displayedGroups.map(group=><section className="cw-league-group" key={group.id} aria-label={`${group.name} ${group.sport==='mma'?'bouts':'games'}`}><button className="cw-league-toggle" aria-expanded={!collapsed.includes(group.id)} aria-label={`${collapsed.includes(group.id)?'Expand':'Collapse'} ${group.name}`} onClick={()=>setCollapsed(old=>old.includes(group.id)?old.filter(id=>id!==group.id):[...old,group.id])}><SportIcon sport={group.sport}/><strong>{group.name}</strong><small>{group.events.length} {group.sport==='mma'?'bouts':'games'}</small>{leagueFreshness(group.leagueId) && <small className="cw-league-fresh">{leagueFreshness(group.leagueId)}</small>}<span aria-hidden="true">{collapsed.includes(group.id)?'+':'−'}</span></button>{!collapsed.includes(group.id)&&group.events.slice(0,showAllGroups.includes(group.id) || (league==='ufc' && group.sport==='mma') ? undefined : homeGroupLimit).map(e=><article key={e.league+e.id} className="cw-event" data-event-status={e.status}>
        <div className="cw-event-info">
          <div className="cw-event-meta"><SportIcon sport={e.sport}/><b>{e.leagueName}</b>{e.fight?.weightClass && <span>{e.fight.weightClass}</span>}<GameStatus status={e.status}>{e.status==='live'?'LIVE · ':''}{e.statusText}{e.shootoutScores&&` · Penalties ${e.shootoutScores.away}–${e.shootoutScores.home}`}{e.status==='live'&&e.clock&&!e.statusText.includes(e.clock)?` · ${e.clock}`:''}</GameStatus>{eventUpdated(e) && <small className="cw-event-updated">{eventUpdated(e)}</small>}<button className="cw-watch" disabled={subscriptions.disabled} aria-label={`${watched.includes(e.league+':'+e.id)?'Unwatch':'Watch'} ${e.name}`} aria-pressed={watched.includes(e.league+':'+e.id)} onClick={()=>toggleWatch(e)}><StarIcon filled={watched.includes(e.league+':'+e.id)}/></button></div>
          <button className="cw-event-detail" aria-label={`Details: ${e.name}`} onClick={()=>openGame(e)}><div className="cw-team"><span className="cw-team-identity"><TeamMark team={e.away}/><RankedTeamName team={e.away}/></span><BoardScore event={e} side="away"/></div><div className="cw-team"><span className="cw-team-identity"><TeamMark team={e.home}/><RankedTeamName team={e.home}/></span><BoardScore event={e} side="home"/></div></button>
          {e.odds && e.status !== 'final' && <div className="cw-event-odds" aria-label={`Reference odds from ${e.odds.provider}`}>
            <span><small>Spread</small><b>{lineValue(e.odds.spread,true)}</b></span>
            <span><small>Total</small><b>{lineValue(e.odds.total)}</b></span>
            <span><small>Away ML</small><b>{americanOdds(e.odds.awayMoneyline)}</b></span>
            <span><small>Home ML</small><b>{americanOdds(e.odds.homeMoneyline)}</b></span>
            {e.odds.drawMoneyline !== null && <span><small>Draw ML</small><b>{americanOdds(e.odds.drawMoneyline)}</b></span>}
          </div>}
          {!liveView&&<div className="cw-event-time"><time dateTime={e.startsAt}>{scheduleTime(e.startsAt,zone)}</time> <span>{canPick(e,now)?'Pre-game':'Entry locked'}</span><button onClick={()=>openGame(e)} aria-label={`Open event information for ${e.name}`}>Details</button></div>}
        </div>
        {liveView?<div className="cw-live-actions">
          <button className="cw-live-open" onClick={()=>openGame(e)}>Game center <ActionIcon action="details"/></button>
          {e.status==='live' && <button className="cw-compare-toggle" id={'cw-compare-'+eventKey(e)} aria-label={`Compare ${e.name}`}
            aria-pressed={comparedKeys.has(eventKey(e))} disabled={compared.length>=comparisonLimit&&!comparedKeys.has(eventKey(e))}
            onClick={()=>toggleComparison(e)}><ActionIcon action="compare"/>{comparedKeys.has(eventKey(e))?'Comparing':'Compare'}</button>}
        </div>:<div className="cw-pick-options">{pickSides(e.league).map(side=>{
          const share = consensusPercent(pickConsensus[consensusKey(e.league,e.id)], side);
          return <button key={side} aria-label={`Pick ${pickName(e,side)}${share !== null ? `, ${share}% of pickers chose this side` : ''}`} aria-pressed={selectionsByGame.get(eventKey(e))?.side===side} onClick={()=>togglePick(e,side)} disabled={pending||!eligiblePick(e)||(selections.length>=5&&!selectionsByGame.has(eventKey(e)))||(dailyLimitReached&&!selectionsByGame.has(eventKey(e)))}><span>{pickName(e,side,'shortName')}</span><small>{selfExcluded?'Excluded':dailyLimitReached?'Limit':canPick(e,now)?side==='draw'?'Pick draw':'Pick winner':'Closed'}</small>{share !== null && <em className="cw-pick-share">{share}%</em>}</button>;
        })}</div>}
      </article>)}{!collapsed.includes(group.id)&&group.events.length>homeGroupLimit&&league!=='ufc'&&(curatedHome&&!showFullBoard
        ? <button className="cw-show-more" onClick={()=>selectLeague(group.events[0].league)}>View all {group.events.length} {group.sport==='mma'?'bouts':'games'} in {group.name}</button>
        : <button className="cw-show-more" aria-expanded={showAllGroups.includes(group.id)} onClick={()=>setShowAllGroups(old=>old.includes(group.id)?old.filter(id=>id!==group.id):[...old,group.id])}>{showAllGroups.includes(group.id)?`Show fewer ${group.sport==='mma'?'bouts':'games'}`:`Show all ${group.events.length} ${group.sport==='mma'?'bouts':'games'}`}</button>)}</section>)}{curatedHome&&<button className="cw-all-leagues" aria-expanded={showFullBoard} onClick={()=>setShowFullBoard(value=>!value)}>{showFullBoard?'Show featured leagues':`View all ${groups.length} leagues`}<span aria-hidden="true">{showFullBoard?'↑':'↓'}</span></button>}</section>}
      {liveView && !golfView && <section className="cw-moments" aria-label="Game updates">
        <h2>Game updates</h2>
        {visibleMoments.length
          ? <GameMomentList moments={visibleMoments.slice(0,12)} onGame={moment=>openMoment(moment.event)}/>
          : <p>Updates for this view will appear here as scores and statuses change.</p>}
      </section>}
      </>:<PicksHistory key={account.user?.id ?? 'guest'} tickets={account.tickets} onUpdate={account.updateTicket} busy={account.ticketsBusy} error={account.ticketsError} onRefresh={()=>void account.loadTickets(true)} user={account.user} onSignIn={()=>setAccountOpen(true)} events={board?.events??[]} onGame={(ticket,event)=>event ? openGame(event) : openSavedGame(ticket.eventId,ticket.league)} onRebet={rebet} onBrowse={openBoard} feedCurrent={!!board&&!board.stale&&!error}/>}
      <footer className="cw-footer"><b>ALL GAME. NO GAMBLING.</b><p>Free-to-play predictions only, available in all 50 states. No money, purchase, cash prizes or wagering. Picks close at scheduled start or when the source marks an event live. Results depend on source confirmation.</p><div className="cw-footer-actions"><button className="cw-terms" aria-current={helpView ? "page" : undefined} onClick={()=>navigate('help')}>Help &amp; rules</button><button className="cw-terms" aria-current={preferencesView ? "page" : undefined} onClick={()=>navigate('preferences')}>Preferences</button><PwaControls/></div></footer>
    </main>{view==='board'&&<aside className="cw-picks-rail">{pickPanel}</aside>}</div>
    <nav className="cw-mobile-nav" aria-label="Mobile navigation"><button aria-pressed={view==='board'&&filter!=='watchlist'} onClick={openBoard}><SportIcon sport="all"/>Sports</button><button aria-pressed={liveView} onClick={openLive}><StatusIcon status="live"/>Live</button><button aria-pressed={view==='board'&&filter==='watchlist'} onClick={openWatchlist}><StarIcon/>Watchlist</button><button aria-pressed={view==='picks'} onClick={openPicks}><ActionIcon action="picks"/>My picks</button></nav>
    {selections.length>0 && <button className="cw-mobile-pick" onClick={()=>setDrawer(true)}>
      {selections.length===1 ? `Your pick: ${pickName(selections[0].event,selections[0].side,'shortName')}` : `Your picks: ${selections.length}`} <span>Review →</span>
    </button>}
    {alertsOpen && <GameAlertsDialog alerts={alerts} onClose={()=>setAlertsOpen(false)}
      onGame={event=>{setAlertsOpen(false);openMoment(event);}}
      onWatchlist={()=>{setAlertsOpen(false);openWatchlist();}}
      onPreferences={()=>{setAlertsOpen(false);navigate('preferences');}}/>}
    {drawer&&<Modal title="Your selection" onClose={()=>setDrawer(false)}>{pickPanel}</Modal>}
    {accountOpen&&<AccountDialog user={account.user} onUser={u=>{account.setUser(u);if(!u){setSelections([]);setReview(false);}}} onClose={()=>setAccountOpen(false)}/>}
    {sharedGameState==='loading'&&<p className="cw-game-link-status" role="status">Opening shared game…</p>}
    {sharedGameState==='unavailable'&&<Modal title="Game unavailable" onClose={closeGame}>
      {savedPick && <div className="cw-dialog-copy">
        <h3>{savedPick.eventName}</h3>
        <p>Your pick: <strong>{savedPick.selection}</strong> · {savedPick.status}</p>
      </div>}
      <p className="cw-dialog-copy">This link could not load a matchup from the sports feed. You can still browse the current scoreboard.</p>
      {failedGame && <button className="cw-primary" onClick={()=>loadGame(failedGame.id,failedGame.league)}>Retry matchup</button>}
      <button className={failedGame?'cw-clear':'cw-primary'} onClick={closeGame}>{view==='picks'?'Back to My picks':'Back to sports board'}</button>
    </Modal>}
    {detail&&<EventDetail event={detail} games={allEvents} onGame={event=>openGame(event,true)}
      boardEvent={detailBoardEvent}
      boardFetchedAt={detailBoardEvent?.scoreSource ? detailLeague?.scoresUpdatedAt : detailLeague?.lastSuccessAt ?? board?.fetchedAt}
      ticket={detailTicket || undefined}
      ticketsLoading={account.ticketsBusy}
      ticketsError={account.ticketsError}
      boardDelayed={!currentLeague(detail.league)}
      watching={watched.includes(detail.league+':'+detail.id)}
      onWatch={()=>toggleWatch(detail)} watchDisabled={subscriptions.disabled}
      onClose={closeGame} onPick={view==='picks'?undefined:(side,market)=>{togglePick(detail,side,market ?? 'moneyline');closeGame();if(window.innerWidth<=700)setDrawer(true);}} picksAvailable={!pending&&eligiblePick(board?.events.find(event=>eventKey(event)===eventKey(detail)))&&(selections.length<5||selectionsByGame.has(eventKey(detail)))} pickConsensus={pickConsensus}/>}
    {review && selections.length>0 && <Modal title={selections.length===1?'Review your free pick':'Review your free picks'} locked={pending} onClose={()=>setReview(false)}>
      {selections.map(({event,side,requestId}) => <div className="cw-review-pick" key={requestId}>
        <p className="cw-dialog-copy">{event.name}</p>
        <div className="cw-review-selection"><small>YOUR CALL</small><strong>{pickName(event,side)}</strong></div>
        <p className="cw-dialog-copy">{scheduleTime(event.startsAt,zone)}</p>
      </div>)}
      <p className="cw-dialog-copy">Each pick is saved and tracked separately. Edit or cancel in My picks before kickoff, subject to a fresh source check.</p>
      {pickError && <p role="alert" className="cw-form-error">{pickError}</p>}
      {selectionDisabled && <p className="cw-form-error">One or more games are unavailable for entry. Close this review to adjust your picks.</p>}
      <button className="cw-primary" disabled={pending||selectionDisabled} onClick={()=>void submitPick()}>
        {pending?(selections.length===1?'Saving free pick…':'Saving free picks…'):selections.length===1?'Confirm free pick':`Confirm ${selections.length} free picks`}
      </button>
      <button className="cw-clear" disabled={pending} onClick={()=>setReview(false)}>Cancel review</button>
    </Modal>}
    {toast&&<div className="cw-toast" role="status"><span>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss notification"><CloseIcon/></button></div>}
  </div></ScheduleTimeZone.Provider>;
}
