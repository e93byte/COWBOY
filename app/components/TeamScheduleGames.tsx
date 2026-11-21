'use client';

import {useEffect, useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {api} from './AccountPicks';
import {MatchCard} from './MatchCard';

type ScheduleProps = {
  league: string;
  teamId: string;
  games: readonly LiveEvent[];
  onGame: (event: LiveEvent) => void;
  excludeId?: string;
};

export function TeamSchedulePreview({name, ...props}: ScheduleProps & {name:string}) {
  const [expanded, setExpanded] = useState(false);
  return <details className="cw-game-section cw-team-schedule cw-team-preview"
    onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>{name} schedule and results</summary>
    {expanded && <TeamScheduleGames {...props}/>}
  </details>;
}

export function TeamScheduleGames({league, teamId, games, onGame, excludeId}: ScheduleProps) {
  const key = `${league}:${teamId}`;
  const [schedule, setSchedule] = useState<{key:string; events?:LiveEvent[]}>();
  const remoteSupported = /^[0-9]{1,10}$/.test(teamId);
  useEffect(() => {
    if (!remoteSupported) return;
    const controller = new AbortController();
    const params = new URLSearchParams({league,team:teamId});
    void api<{events:LiveEvent[]}>(`/api/sports/team-schedule?${params}`,{signal:controller.signal})
      .then(({events})=>{
        if (!controller.signal.aborted) setSchedule({key,events});
      })
      .catch(()=>{
        if (!controller.signal.aborted) setSchedule({key});
      });
    return () => controller.abort();
  },[key,league,teamId,remoteSupported]);
  const teamSchedule = schedule?.key === key ? schedule : undefined;
  const visible = new Map((teamSchedule?.events ?? []).map(game=>[game.id,game]));
  for (const game of games) {
    if (game.league !== league) continue;
    const coverage = visible.get(game.id)?.broadcasts;
    visible.set(game.id,game.broadcasts || !coverage ? game : {...game,broadcasts:coverage});
  }
  const teamGames = [...visible.values()].filter(game => game.id !== excludeId &&
    (game.away.id === teamId || game.home.id === teamId))
    .sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const upcoming = teamGames.filter(game => game.status === 'scheduled' || game.status === 'live').slice(0, 4);
  const finals = teamGames.filter(game => game.status === 'final').slice(-4).reverse();

  return <>
    {!teamSchedule?.events && <p className="cw-game-section-note" role="status">
      {remoteSupported && !teamSchedule ? 'Loading team schedule…' : 'Showing games available on the current scoreboard.'}
    </p>}
    {[
      {label:'Live and upcoming', games:upcoming, empty:'No live or upcoming games are available.'},
      {label:'Recent finals', games:finals, empty:'No recent finals are available.'},
    ].map(group => <section key={group.label} aria-label={group.label}>
      <h4>{group.label}</h4>
      {group.games.length ? <div className="cw-team-schedule-games">
        {group.games.map(game => <MatchCard key={game.id} event={game} label={`Open ${game.name}`} onOpen={onGame} showBroadcasts/>)}
      </div> : <p className="cw-game-section-note">{group.empty}</p>}
    </section>)}
  </>;
}
