'use client';

import {useContext, useState} from 'react';
import { ScheduleTimeZone } from './ScheduleTimeZone';
import type {GolfTournament} from '../lib/live-sports';

function Tournament({event, players}: {event: GolfTournament; players: GolfTournament['leaderboard']}) {
  const zone = useContext(ScheduleTimeZone);
  const [shown, setShown] = useState(15);

  return <section className="cw-golf-event" aria-label={event.name}>
    <h3>{event.name}</h3>
    <p>{event.statusText} · <time dateTime={event.startsAt}>{new Date(event.startsAt).toLocaleDateString(undefined, {timeZone:zone==='local'?undefined:zone})}</time></p>
    {players.length ? <>
      <table className="cw-golf-table">
        <caption className="sr-only">{event.name} leaderboard</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">To par</th></tr></thead>
        <tbody>{players.slice(0, shown).map(player=><tr key={player.id}>
          <th scope="row">{player.name}</th>
          <td>{player.displayScore ?? player.score ?? '—'}</td>
        </tr>)}</tbody>
      </table>
      {players.length > shown && <button onClick={()=>setShown(value=>value+15)}>Show more players</button>}
    </> : <p>Player scores are unavailable.</p>}
  </section>;
}

export function GolfLeaderboard({events}: {events: GolfTournament[]}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = events.flatMap(event=>{
    if (event.name.toLowerCase().includes(query)) return [{event, players:event.leaderboard}];
    const players = event.leaderboard.filter(player=>player.name.toLowerCase().includes(query));
    return players.length ? [{event, players}] : [];
  });

  return <section className="cw-golf-leaderboard" aria-label="PGA leaderboard">
    {events.length > 0 && <label className="cw-golf-search">
      <span>Find a player or tournament</span>
      <input type="search" value={search} onChange={event=>setSearch(event.target.value)}/>
    </label>}
    {matches.length ? matches.map(({event, players})=><Tournament key={event.id + ':' + query} event={event} players={players}/>)
      : <div className="cw-empty"><h3>{events.length ? 'No matching players or tournaments' : 'No tournaments in this view'}</h3></div>}
  </section>;
}
