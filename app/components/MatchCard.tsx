'use client';

import {useContext, useEffect, useRef, useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {scheduleTime} from '../lib/schedule-time';
import {ScheduleTimeZone} from './ScheduleTimeZone';
import {ActionIcon, SportIcon, StatusIcon} from './SportIcon';
import {RankedTeamName, TeamMark} from './TeamMark';

function SourceScore({score,tiebreak}:{score:number|null;tiebreak?:number|null}) {
  const previous = useRef({score,tiebreak});
  const [changed,setChanged] = useState<'up'|'correction'|null>(null);
  useEffect(()=>{
    const was = previous.current;
    previous.current = {score,tiebreak};
    const before = score !== was.score ? was.score : was.tiebreak;
    const after = score !== was.score ? score : tiebreak;
    if (before == null || after == null || before === after) {
      setChanged(null);
      return;
    }
    setChanged(after > before ? 'up' : 'correction');
    const timer = setTimeout(()=>setChanged(null),1600);
    return ()=>clearTimeout(timer);
  },[score,tiebreak]);
  return <b className={changed?'cw-scores-updated':undefined} data-score-change={changed??undefined}>
    {score??'—'}{tiebreak!=null && <sup aria-hidden="true">{tiebreak}</sup>}
  </b>;
}

export function GameStatus({status,children}:{status:LiveEvent['status'];children:React.ReactNode}) {
  const previous = useRef(status);
  const [changed,setChanged] = useState(false);
  useEffect(()=>{
    if (previous.current === status) return;
    previous.current = status;
    setChanged(true);
    const timer = setTimeout(()=>setChanged(false),2200);
    return ()=>clearTimeout(timer);
  },[status]);
  return <span className="cw-game-state" data-game-state={status} data-status-change={changed || undefined}>
    <StatusIcon status={status}/><span>{children}</span>
  </span>;
}

export function MatchStatus({event, scheduledLabel, clockStale}: {event: LiveEvent; scheduledLabel?: string; clockStale?: boolean}) {
  const {status, statusText, clock, shootoutScores} = event;
  return <GameStatus status={status}>
    {status === 'live' && 'Live · '}
    {status === 'scheduled' ? scheduledLabel ?? 'Upcoming' : statusText}
    {status === 'live' && clock && !statusText.includes(clock) && ` · ${clock}`}
    {status === 'live' && clockStale && ' · feed delayed'}
    {shootoutScores && ` · Penalties ${shootoutScores.away}–${shootoutScores.home}`}
  </GameStatus>;
}

export function BoardScore({event, side}: {event: LiveEvent; side: 'home' | 'away'}) {
  const team = event[side];
  if (event.fight) return event.completed && event.winner === side ? <b className="cw-result-winner">Won</b> : null;
  if ((event.status === 'live' || event.completed) && event.sport === 'tennis' && team.linescores?.length) {
    const sets = team.linescores.map((score,index)=>({score,tiebreak:team.tennisSetDetails?.[index]?.tiebreak}));
    return <span className="cw-set-scores" aria-label={sets.map(({score,tiebreak},index)=>
      `Set ${index+1}: ${score??'unavailable'}${tiebreak!=null ? `, tiebreak points: ${tiebreak}` : ''}`).join(', ')}>
      {sets.map(({score,tiebreak},index)=><SourceScore key={index} score={score} tiebreak={tiebreak}/>)}
    </span>;
  }
  return <SourceScore score={event.status === 'scheduled' ? null : team.score}/>;
}

export function MatchCard({event, onOpen, label, showBroadcasts = false, clockStale}: {
  event: LiveEvent;
  onOpen: (event: LiveEvent) => void;
  label?: string;
  showBroadcasts?: boolean;
  clockStale?: boolean;
}) {
  const zone = useContext(ScheduleTimeZone);
  const broadcasts = showBroadcasts && (event.status === 'scheduled' || event.status === 'live') && event.broadcasts?.length
    ? event.broadcasts.map(({name,region})=>region ? `${name} (${region})` : name).join(' · ')
    : undefined;
  return <button className="cw-match-card" aria-label={label ?? `Explore ${event.name}`} onClick={() => onOpen(event)}>
    <span className="cw-match-meta">
      <span><SportIcon sport={event.sport}/>{event.leagueName}</span>
      <MatchStatus event={event} clockStale={clockStale} scheduledLabel={event.status === 'scheduled' ? scheduleTime(event.startsAt,zone) : undefined}/>
    </span>
    <span className="cw-match-lines">
      {(['away','home'] as const).map(side => (
        <span key={side} className="cw-match-line">
          <TeamMark team={event[side]}/>
          <strong><RankedTeamName team={event[side]}/></strong>
          {event.status !== 'scheduled' && <BoardScore event={event} side={side}/>}
        </span>
      ))}
    </span>
    {broadcasts && <span className="cw-match-broadcast">Coverage · {broadcasts}</span>}
    <span className="cw-match-link">Game center <ActionIcon action="details"/></span>
  </button>;
}
