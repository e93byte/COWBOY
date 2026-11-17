'use client';

import {useContext, useEffect, useRef, useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {scheduleTime} from '../lib/schedule-time';
import {ScheduleTimeZone} from './ScheduleTimeZone';
import {SportIcon} from './SportIcon';
import {TeamMark} from './TeamMark';

function SourceScore({score,tiebreak}:{score:number|null;tiebreak?:number|null}) {
  const previous=useRef(score);
  const [changed,setChanged]=useState(false);
  useEffect(()=>{
    const was=previous.current;
    previous.current=score;
    if(was===null||score===null||was===score)return;
    setChanged(true);
    const timer=setTimeout(()=>setChanged(false),1600);
    return()=>clearTimeout(timer);
  },[score]);
  return <b className={changed?'cw-scores-updated':undefined}>
    {score??'—'}{tiebreak!=null && <sup aria-hidden="true">{tiebreak}</sup>}
  </b>;
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

export function MatchCard({event, onOpen, label}: {event: LiveEvent; onOpen: (event: LiveEvent) => void; label?: string}) {
  const zone = useContext(ScheduleTimeZone);
  return <button className="cw-match-card" aria-label={label ?? `Explore ${event.name}`} onClick={() => onOpen(event)}>
    <span className="cw-match-meta">
      <span><SportIcon sport={event.sport}/>{event.leagueName}</span>
      <strong className={event.status === 'live' ? 'cw-live-label' : undefined}>
        {event.status === 'scheduled' ? scheduleTime(event.startsAt,zone) : event.status === 'live' ? `Live · ${event.clock || event.statusText}` : event.statusText}
      </strong>
    </span>
    <span className="cw-match-lines">
      {(['away','home'] as const).map(side => (
        <span key={side} className="cw-match-line">
          <TeamMark team={event[side]}/>
          <strong>{event[side].name}</strong>
          {event.status !== 'scheduled' && <BoardScore event={event} side={side}/>}
        </span>
      ))}
    </span>
    <span className="cw-match-link">Game center <span aria-hidden="true">→</span></span>
  </button>;
}
