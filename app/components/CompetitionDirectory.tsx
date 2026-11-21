'use client';

import {useState} from 'react';
import {SPORTS_CATALOGUE} from '../lib/sports-leagues';
import {SportIcon} from './SportIcon';

const sports = [...new Set(SPORTS_CATALOGUE.map(league=>league.sport))].sort();
const regions = [...new Set(SPORTS_CATALOGUE.map(league=>league.region))].sort();
const label = (value:string) => value === 'aussierules' ? 'Australian rules' :
  value === 'mma' ? 'MMA' : value.replaceAll('_',' ').replace(/^./,first=>first.toUpperCase());
const normalize = (value:string) => value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const pageSize = 24;

export default function CompetitionDirectory() {
  const [sport,setSport] = useState('');
  const [region,setRegion] = useState('');
  const [query,setQuery] = useState('');
  const [limit,setLimit] = useState(pageSize);
  const term = normalize(query.trim());
  const matches = SPORTS_CATALOGUE.filter(league=>(!sport||league.sport===sport) &&
    (!region||league.region===region) &&
    normalize(`${league.name} ${league.region} ${label(league.sport)}`).includes(term));
  return <>
    <div className="cw-discover-filters">
      <div><label htmlFor="discover-query">Search competitions</label><input id="discover-query" type="search" value={query} onChange={event=>{setQuery(event.target.value);setLimit(pageSize);}}/></div>
      <div><label htmlFor="discover-sport">Sport</label><select id="discover-sport" value={sport} onChange={event=>{setSport(event.target.value);setLimit(pageSize);}}>
        <option value="">All sports</option>
        {sports.map(item=><option key={item} value={item}>{label(item)}</option>)}
      </select></div>
      <div><label htmlFor="discover-region">Region</label><select id="discover-region" value={region} onChange={event=>{setRegion(event.target.value);setLimit(pageSize);}}>
        <option value="">All regions</option>
        {regions.map(item=><option key={item} value={item}>{item}</option>)}
      </select></div>
    </div>
    <p className="cw-discover-count" role="status">{matches.length} {matches.length===1?'competition':'competitions'}</p>
    {matches.length ? <ul className="cw-discover-list">
      {matches.slice(0,limit).map(league=><li key={league.id}>
        <a href={`/?filterLeague=${encodeURIComponent(league.id)}`}>
          <SportIcon sport={league.sport}/>
          <span><strong>{league.name}</strong><small>{league.region} · {label(league.sport)}</small></span>
          {!league.sourceEnabled && <small>Catalogue only</small>}
        </a>
      </li>)}
    </ul> : <p>Try a different competition, sport, or region.</p>}
    {matches.length>limit && <button className="cw-discover-more" onClick={()=>setLimit(value=>value+pageSize)}>View more competitions</button>}
  </>;
}
