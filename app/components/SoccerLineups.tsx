import {useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {TeamMark} from './TeamMark';

type Lineup = NonNullable<NonNullable<LiveEvent['soccerLineups']>['home']>;

const positions: Record<string, [line: number, side: number]> = {
  'Goalkeeper': [0, 0],
  'Left Back': [1, -2],
  'Center Left Defender': [1, -1],
  'Center Back': [1, 0],
  'Center Defender': [1, 0],
  'Center Right Defender': [1, 1],
  'Right Back': [1, 2],
  'Left Defensive Midfielder': [2, -1],
  'Defensive Midfielder': [2, 0],
  'Right Defensive Midfielder': [2, 1],
  'Left Midfielder': [3, -2],
  'Center Left Midfielder': [3, -1],
  'Center Midfielder': [3, 0],
  'Center Right Midfielder': [3, 1],
  'Right Midfielder': [3, 2],
  'Attacking Midfielder Left': [4, -2],
  'Left Attacking Midfielder': [4, -2],
  'Attacking Midfielder': [4, 0],
  'Attacking Midfielder Right': [4, 2],
  'Right Attacking Midfielder': [4, 2],
  'Left Forward': [5, -2],
  'Forward': [5, 0],
  'Right Forward': [5, 2],
};

function formationRows(lineup?: Lineup) {
  if (lineup?.starters.length !== 11 || !/^\d(?:-\d){1,4}$/.test(lineup.formation)) return null;
  const rows = Array.from({length: 6}, (): Lineup['starters'] => []);
  for (const player of lineup.starters) {
    const role = positions[player.position];
    if (!role) return null;
    rows[role[0]].push(player);
  }
  const occupied = rows.filter(row => row.length);
  const expected = [1, ...lineup.formation.split('-').map(Number)];
  if (rows[0].length !== 1 || occupied.length !== expected.length ||
      occupied.some((row, index) => row.length !== expected[index])) return null;
  return occupied.reverse().map(row => row.sort((a, b) => positions[a.position][1] - positions[b.position][1]));
}

function Pitch({rows}: {rows: Lineup['starters'][]}) {
  return <div className="cw-lineup-pitch" aria-label="Starting positions" role="group">
    {rows.map((row, index) => <ul key={index} className="cw-pitch-row">
      {row.map(player => <li key={player.id} title={player.position}>
        <span aria-hidden="true">{player.jersey || '—'}</span>
        <strong>{player.name}</strong>
      </li>)}
    </ul>)}
  </div>;
}

function Roster({players,bench=false}: {players:Lineup['starters'];bench?:boolean}) {
  return <ul className="cw-soccer-roster">
    {players.map(player=><li key={player.id}>
      <span className="cw-roster-number">{player.jersey ? <><span className="sr-only">Shirt </span>{player.jersey}</> : '—'}</span>
      <div><strong>{player.name}</strong>{player.position && <small>{player.position}</small>}</div>
      {bench && player.subbedIn && <span className="cw-sub-used">Played</span>}
    </li>)}
  </ul>;
}

export function SoccerLineups({event,busy,onRefresh}: {event:LiveEvent;busy:boolean;onRefresh:()=>void}) {
  const lineups = event.soccerLineups;
  const [showFormation, setShowFormation] = useState(false);
  const formations = {away: formationRows(lineups?.away), home: formationRows(lineups?.home)};
  const canShowFormation = Boolean(formations.away || formations.home);
  return <section className="cw-game-section" aria-label="Soccer lineups">
    <div className="cw-game-stats-heading">
      <h3>Lineups</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh lineups'}</button>
    </div>
    {!lineups ? <p className="cw-game-section-note">{busy ? 'Loading lineups…' : 'No lineup is available for this match.'}</p> :
      <>
      {canShowFormation && <div className="cw-lineup-view">
        <button type="button" aria-pressed={showFormation} onClick={() => setShowFormation(!showFormation)}>
          Formation view
        </button>
      </div>}
      <div className="cw-lineup-teams">
        {(['away','home'] as const).map(side=>{
          const team = event[side];
          const lineup = lineups[side];
          const rows = formations[side];
          const used = lineup?.bench.filter(player=>player.subbedIn).length ?? 0;
          return <section key={side} className="cw-lineup-team" aria-label={`${team.name} lineup`}>
            <div className="cw-lineup-team-heading">
              <TeamMark team={team}/>
              <h4>{team.name}</h4>
              {lineup?.formation && <strong className="cw-formation">{lineup.formation}</strong>}
            </div>
            {!lineup ? <p>No starters are available for this team.</p> : <>
              <h5>{lineup.starters.length===11 ? 'Starting XI' : `Listed starters (${lineup.starters.length})`}</h5>
              {showFormation && rows ? <Pitch rows={rows}/> : <Roster players={lineup.starters}/>}
              {!!lineup.bench.length && <details>
                <summary>Substitutes ({lineup.bench.length}){used>0 ? ` · ${used} played` : ''}</summary>
                <Roster players={lineup.bench} bench/>
              </details>}
            </>}
          </section>;
        })}
      </div>
      </>}
  </section>;
}
