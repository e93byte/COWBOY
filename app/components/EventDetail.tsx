'use client';

import {useContext, useEffect, useRef, useState, type CSSProperties} from 'react';
import {matchesSearchText} from './BoardSearch';
import {Modal, api, type Ticket} from './AccountPicks';
import {SportIcon, StarIcon} from './SportIcon';
import {TeamMark} from './TeamMark';
import type {LiveEvent} from './LiveWorkspace';
import { pickName, pickSides, supportsDrawPick, type PickSide } from '../lib/pick-outcomes';
import { ScheduleTimeZone } from './ScheduleTimeZone';
import { ScoreProgression } from './ScoreProgression';
import { SoccerLineups } from './SoccerLineups';
import { scheduleTime } from '../lib/schedule-time';
import { BoardScore } from './MatchCard';
import { LIVE_SCORE_REFRESH_MS } from '../lib/score-refresh';

function FootballField({event, position}: {event: LiveEvent; position: NonNullable<LiveEvent['footballPosition']>}) {
  return <section className="cw-football-field" aria-label="Football field position">
    <div className="cw-field-context">
      <strong>{event[position.possession].name} possession</strong>
      <span>{position.downAndDistance} at {position.spot}</span>
    </div>
    <div className="cw-football-pitch" aria-hidden="true" style={{'--ball-position': position.fieldPercent + '%'} as CSSProperties}>
      <span className="cw-football-endzone">{event.away.shortName}</span>
      <div className="cw-football-yards">
        <span>20</span><span>50</span><span>20</span>
        <i className="cw-football-ball"/>
      </div>
      <span className="cw-football-endzone">{event.home.shortName}</span>
    </div>
  </section>;
}

function FootballDrives({event, busy, onRefresh}: {event: LiveEvent; busy: boolean; onRefresh: () => void}) {
  const [limit,setLimit] = useState(12);
  const drives = event.footballDrives ?? [];
  return <section className="cw-game-section" aria-label="Football drives">
    <div className="cw-game-stats-heading">
      <h3>Possession drives</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh drives'}</button>
    </div>
    {drives.length ? <ol className="cw-football-drives">
      {drives.slice(0,limit).map(drive => {
        const team = event[drive.side];
        const position = drive.from && drive.to ? drive.from + ' to ' + drive.to : drive.from || drive.to;
        const stamp = [drive.period ? 'Period ' + drive.period : null,drive.clock].filter(Boolean).join(' · ');
        return <li key={drive.id} data-scored={drive.scoring}>
          <TeamMark team={team}/>
          <div>
            <strong>{team.name}</strong>
            <span>{drive.result ?? 'In progress'}</span>
            {position && <small>{position}</small>}
          </div>
          <div className="cw-drive-numbers">
            <span>{[
              drive.plays === null ? null : drive.plays + (drive.plays === 1 ? ' play' : ' plays'),
              drive.yards === null ? null : drive.yards + (drive.yards === 1 ? ' yd' : ' yds'),
              drive.duration,
            ].filter(value=>value!==null).join(' · ')}</span>
            {stamp && <small>{drive.result ? stamp : 'Started ' + stamp}</small>}
          </div>
        </li>;
      })}
    </ol> : <p>{event.status==='scheduled' ? 'Drives appear after kickoff.' : 'ESPN has not published drive data for this game.'}</p>}
    {drives.length > limit && <button onClick={()=>setLimit(value=>value+12)}>Show earlier drives</button>}
  </section>;
}

function PeriodScores({event}: {event: LiveEvent}) {
  const periods = Math.max(event.away.linescores?.length ?? 0, event.home.linescores?.length ?? 0);
  if (!periods) return null;
  const indices = Array.from({length: periods}, (_, index) => index);
  const tennis = event.sport === 'tennis';
  const title = tennis ? 'Score by set' : 'Score by period';
  const activeIndex = tennis && event.status === 'live' && event.period ? event.period - 1 : -1;
  const setWinners = tennis ? indices.map(index => {
    const home = event.home.tennisSetDetails?.[index]?.winner;
    const away = event.away.tennisSetDetails?.[index]?.winner;
    if (index === activeIndex) return null;
    return home === true && away === false ? 'home' : away === true && home === false ? 'away' : null;
  }) : [];
  const hasSetWinners = setWinners.some(Boolean);
  const hasTotal = !tennis && (event.away.score !== null || event.home.score !== null);
  return <div className="cw-linescores-scroll" role="region" aria-label={title} tabIndex={0}>
    <table className="cw-linescores">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{tennis ? 'Player' : 'Team'}</th>
          {indices.map(index => <th scope="col" key={index} className={index===activeIndex ? 'cw-active-set' : undefined}>
            {tennis ? `Set ${index + 1}` : index + 1}{index===activeIndex && <span className="sr-only"> (in progress)</span>}
          </th>)}
          {hasSetWinners && <th scope="col">Sets won<span className="sr-only"> (confirmed by source)</span></th>}
          {hasTotal && <th scope="col">Total</th>}
        </tr>
      </thead>
      <tbody>
        {(['away','home'] as const).map(side => {
          const team = event[side];
          return <tr key={team.id}>
            <th scope="row">{team.shortName}</th>
            {indices.map(index => {
              const tiebreak = tennis ? team.tennisSetDetails?.[index]?.tiebreak : null;
              return <td key={index} className={index===activeIndex ? 'cw-active-set' : setWinners[index]===side ? 'cw-won-set' : undefined}>
                {setWinners[index]===side && <span className="sr-only">Won set: </span>}
                {team.linescores?.[index] ?? '—'}
                {tiebreak != null && <sup><span className="sr-only">, tiebreak points: </span>{tiebreak}</sup>}
              </td>;
            })}
            {hasSetWinners && <td>{setWinners.filter(winner=>winner===side).length}</td>}
            {hasTotal && <td>{team.score ?? '—'}</td>}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

type Props = {
  event: LiveEvent;
  boardEvent?: LiveEvent;
  boardFetchedAt?: string;
  boardDelayed?: boolean;
  ticket?: Ticket;
  ticketsLoading: boolean;
  ticketsError: string;
  watching: boolean;
  onWatch: () => void;
  watchDisabled?: boolean;
  onPick?: (side: PickSide) => void;
  picksAvailable?: boolean;
};

function GameLeaders({event,leaders,summaryOnly=false}: {
  event: LiveEvent;
  leaders: NonNullable<LiveEvent['leaders']>;
  summaryOnly?: boolean;
}) {
  const [expanded,setExpanded] = useState(false);
  return <section className={`cw-game-leaders ${summaryOnly?'cw-game-section':''}`} aria-label="Game leaders">
    <h3>Game leaders</h3>
    <table className="cw-leader-table" aria-label="Player leaders by team">
      <thead><tr><th scope="col">Category</th><th scope="col">{event.away.shortName}</th><th scope="col">{event.home.shortName}</th></tr></thead>
      <tbody>{leaders.slice(0,summaryOnly&&!expanded?3:undefined).map(category=><tr key={category.key}>
        <th scope="row">{category.label}</th>
        {(['away','home'] as const).map(side=><td key={side}>{category[side].length ? category[side].map(player=>(
          <div className="cw-leader-player" key={player.id}>
            {player.headshot && <TeamMark team={{name:player.name,shortName:'',logo:player.headshot}} small/>}
            <div><strong>{player.name}</strong><small>{player.value}</small></div>
          </div>
        )) : '—'}</td>)}
      </tr>)}</tbody>
    </table>
    {summaryOnly && leaders.length>3 && <button aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
      {expanded?'Show fewer leaders':'See all leaders'}
    </button>}
  </section>;
}

const soccerComparisonStats = [
  {key:'possessionPct',label:'Possession',percent:true},
  {key:'totalShots',label:'Shots',percent:false},
  {key:'shotsOnTarget',label:'Shots on target',percent:false},
];

function soccerTeamStats(stats: NonNullable<LiveEvent['teamStats']>) {
  const byKey = new Map(stats.map(stat=>[stat.key, stat]));
  const ordered = soccerComparisonStats.flatMap(metric=>{
    const stat = byKey.get(metric.key);
    if (!stat) return [];
    byKey.delete(metric.key);
    const labelValue = (value: string | null) =>
      metric.percent && value && /^\d+(?:\.\d+)?$/.test(value) ? value+'%' : value;
    const numberValue = (value: string | null) =>
      value && /^\d+(?:\.\d+)?%?$/.test(value) ? Number.parseFloat(value) : Number.NaN;
    const away = numberValue(stat.away);
    const home = numberValue(stat.home);
    const total = away+home;
    const valid = Number.isFinite(total) && total>0 && (!metric.percent || Math.abs(total-100)<1);
    return [{...stat,label:metric.label,away:labelValue(stat.away),home:labelValue(stat.home),
      share:valid ? 100*away/total : null}];
  });
  return [...ordered,...Array.from(byKey.values(), stat=>({...stat,share:null}))];
}

function GameStats({event, summary, busy, onRefresh}: {
  event: LiveEvent;
  summary?: LiveEvent | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  const teamStats = summary?.teamStats ?? [];
  const soccer = event.sport === 'soccer';
  const rows = soccer ? soccerTeamStats(teamStats) : teamStats.map(stat=>({...stat,share:null}));
  const plays = summary?.scoringPlays ?? [];
  const [allStats, setAllStats] = useState(false);
  const [allPlays, setAllPlays] = useState(false);
  return <section className="cw-game-section cw-game-stats" aria-label="Game statistics">
    <div className="cw-game-stats-heading">
      <h3>Team stats</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh stats'}</button>
    </div>
    {teamStats.length > 0 ? <><table className={`cw-team-stats-table${soccer ? ' cw-soccer-stats-table' : ''}`} aria-label="Team statistics comparison">
      <thead><tr>
        <th scope="col">{event.away.shortName}</th>
        <th scope="col">Statistic</th>
        <th scope="col">{event.home.shortName}</th>
      </tr></thead>
      <tbody>{rows.slice(0, allStats ? undefined : 8).map(stat => <tr key={stat.key}>
        <td>{stat.away ?? '—'}</td>
        <th scope="row">{stat.label}{stat.share !== null && <span className="cw-stat-share" aria-hidden="true">
          <span style={{width:`${stat.share}%`}}/>
        </span>}</th>
        <td>{stat.home ?? '—'}</td>
      </tr>)}</tbody>
    </table>
      {teamStats.length > 8 && <button aria-expanded={allStats} onClick={() => setAllStats(value => !value)}>
        {allStats ? 'Show fewer stats' : `Show all ${teamStats.length} stats`}
      </button>}
    </> : <p className="cw-game-section-note">{
      busy ? 'Loading team statistics…' : event.status === 'scheduled'
        ? 'Team statistics appear after the game starts when ESPN provides them.'
        : 'ESPN has not provided team statistics for this event.'
    }</p>}
    {!!summary?.leaders?.length && <GameLeaders event={event} leaders={summary.leaders}/>}
    {plays.length > 0 && <section className="cw-scoring-plays" aria-label="Scoring plays">
      <h3>Scoring plays</h3>
      <ol>{plays.slice(0, allPlays ? undefined : 5).map(play => <li key={play.id}>
        {play.side && <TeamMark team={event[play.side]} small/>}
        <div>
          <p>{play.description}</p>
          <small>{[play.period && `Period ${play.period}`, play.clock].filter(Boolean).join(' · ')}</small>
        </div>
        {play.awayScore !== null && play.homeScore !== null && <strong
          aria-label={`${event.away.shortName} ${play.awayScore}, ${event.home.shortName} ${play.homeScore}`}
        >{play.awayScore}–{play.homeScore}</strong>}
      </li>)}</ol>
      {plays.length > 5 && <button aria-expanded={allPlays} onClick={() => setAllPlays(value => !value)}>
        {allPlays ? 'Show fewer plays' : `Show all ${plays.length} scoring plays`}
      </button>}
    </section>}
  </section>;
}

function GameStandings({event,busy,onRefresh}: {event:LiveEvent;busy:boolean;onRefresh:()=>void}) {
  const [expanded,setExpanded] = useState(false);
  const nba = event.league === 'nba';
  const groups = (nba ? event.nbaStandings : event.soccerStandings) ?? [];
  const isMatchTeam = (id: string) => id === event.home.id || id === event.away.id;
  const canExpand = groups.some(group=>group.rows.slice(5).some(row=>!isMatchTeam(row.teamId)));
  return <section className="cw-game-section" aria-label="League standings">
    <div className="cw-game-stats-heading">
      <h3>Standings</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh standings'}</button>
    </div>
    {groups.length ? <>
      <p className="cw-game-section-note">Latest table included in the ESPN game summary.</p>
      {groups.map((group,index) => <table className="cw-team-stats-table cw-standings-table" key={index}>
        <caption>{group.title}</caption>
        <thead><tr>
          {!nba && <th scope="col">Rank</th>}<th scope="col" className="cw-standings-team">Team</th>
          {nba ? <>
            <th scope="col"><abbr title="Wins">W</abbr></th>
            <th scope="col"><abbr title="Losses">L</abbr></th>
            <th scope="col"><abbr title="Win percentage">PCT</abbr></th>
            <th scope="col"><abbr title="Games behind">GB</abbr></th>
          </> : <>
            <th scope="col"><abbr title="Played">P</abbr></th>
            <th scope="col"><abbr title="Goal difference">GD</abbr></th>
            <th scope="col"><abbr title="Points">Pts</abbr></th>
          </>}
        </tr></thead>
        <tbody>{group.rows.filter((row,index)=>expanded || index < 5 || isMatchTeam(row.teamId)).map(row => {
          const matchTeam = isMatchTeam(row.teamId);
          return <tr key={row.teamId} data-match-team={matchTeam}>
            {'rank' in row && <td>{row.rank}</td>}
            <th scope="row">{row.name}{matchTeam && <span className="sr-only"> (playing this match)</span>}</th>
            {'wins' in row ? <>
              <td>{row.wins ?? '—'}</td><td>{row.losses ?? '—'}</td>
              <td>{row.winPercent?.toFixed(3).replace(/^0\./,'.') ?? '—'}</td><td>{row.gamesBehind ?? '—'}</td>
            </> : <>
              <td>{row.played ?? '—'}</td>
              <td>{row.goalDifference === null ? '—' : row.goalDifference > 0 ? '+'+row.goalDifference : row.goalDifference}</td>
              <td>{row.points ?? '—'}</td>
            </>}
          </tr>;
        })}</tbody>
      </table>)}
      {canExpand && <button aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
        {expanded ? 'Show fewer teams' : 'Show full standings'}
      </button>}
    </> : <p className="cw-game-section-note">{busy ? 'Loading standings…' : 'ESPN has not supplied standings for this matchup.'}</p>}
  </section>;
}

function Matchup({event, matchup, busy, onRefresh}: {
  event: LiveEvent;
  matchup: LiveEvent['matchup'];
  busy: boolean;
  onRefresh: () => void;
}) {
  const zone = useContext(ScheduleTimeZone);
  const showInjuries = (event.status === 'scheduled' || event.status === 'live') &&
    Boolean(matchup?.away.injuries.length || matchup?.home.injuries.length);
  const dateLabel = (date: string) => new Date(date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});

  return <section className="cw-game-section cw-matchup" aria-label="Matchup information">
    <div className="cw-game-stats-heading">
      <h3>Team matchup</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh matchup'}</button>
    </div>
    {!matchup ? <p className="cw-game-section-note">{
      busy ? 'Loading matchup information…' : 'ESPN has not provided matchup information for this event.'
    }</p> : <>
      {matchup.series && <p className="cw-series-result">{matchup.series}</p>}
      {!!matchup.seriesGames?.length && <section className="cw-season-series" aria-label="Head-to-head games">
        <h4>Head-to-head games</h4>
        <ul>
          {matchup.seriesGames.map(game => {
            const current = game.id === event.id;
            const name = `${game.awayName} at ${game.homeName}`;
            const status = {scheduled:'Scheduled',live:'Live',final:'Final'}[game.state];
            const content = <>
              <strong>{name}</strong>
              <time dateTime={game.date}>{scheduleTime(game.date,zone)}</time>
              <span>{status}{game.score ? ` · ${game.score}` : ''}</span>
            </>;
            return <li key={game.id}>
              {current ? <div aria-current="true">{content}</div>
                : <a href={'/?'+new URLSearchParams({game:game.id,league:event.league,section:'matchup'})}>{content}</a>}
            </li>;
          })}
        </ul>
      </section>}
      <div className="cw-matchup-teams">
        {(['away', 'home'] as const).map(side => {
          const team = event[side];
          const info = matchup[side];
          return <div className="cw-matchup-team" key={side}>
            <div className="cw-matchup-team-heading">
              <TeamMark team={team}/>
              <div>
                <h4>{team.name}</h4>
                {info.record && <span>Team record {info.record}</span>}
              </div>
            </div>
            <h5>Recent results</h5>
            {info.recent.length ? <ol className="cw-recent-results" aria-label={`${team.name} recent results`}>
              {info.recent.map(game => <li key={game.id}>
                <span className="cw-result-badge" data-result={game.result}>{game.result}</span>
                <div><span>{game.away ? 'at' : 'vs'} {game.opponent}</span><time dateTime={game.date}>{dateLabel(game.date)}</time></div>
                {game.score && <strong>{game.score}</strong>}
              </li>)}
            </ol> : <p className="cw-game-section-note">Recent results unavailable.</p>}
            {showInjuries && <>
              <h5>Team injury report</h5>
              {info.injuries.length ? <ul className="cw-injury-report" aria-label={`${team.name} injury report`}>
                {info.injuries.map(player => <li key={player.id}>
                  <strong>{player.name}{player.position && <small> · {player.position}</small>}</strong>
                  <span>{player.status}{player.injury && ` · ${player.injury}`}</span>
                  {player.reportedAt && <time dateTime={player.reportedAt}>Reported {dateLabel(player.reportedAt)}</time>}
                </li>)}
              </ul> : <p className="cw-game-section-note">ESPN supplied no report for this team.</p>}
            </>}
          </div>;
        })}
      </div>
      {showInjuries && <p className="cw-game-section-note">Injury reports may change before the game.</p>}
    </>}
  </section>;
}

function GameTimeline({event, busy, onRefresh}: {
  event: LiveEvent;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [scoringOnly, setScoringOnly] = useState(false);
  const [period, setPeriod] = useState('all');
  const [visible, setVisible] = useState(20);
  const plays = (scoringOnly ? event.scoringPlays : event.timeline ?? event.scoringPlays) ?? [];
  const periods = [...new Set([...(event.timeline ?? []), ...(event.scoringPlays ?? [])]
    .flatMap(play => play.period === null ? [] : [play.period]))].sort((a, b) => a - b);
  const filtered = period === 'all' ? plays : plays.filter(play => String(play.period) === period);
  const soccer = event.sport === 'soccer';
  const entryLabel = soccer ? 'event' : 'play';
  const commentary = event.soccerCommentary ?? [];
  const [showCommentary, setShowCommentary] = useState(false);
  const [visibleCommentary, setVisibleCommentary] = useState(20);
  const commentarySelected = soccer && showCommentary && commentary.length > 0;


  return <section className="cw-game-section" aria-label="Game timeline">
    <div className="cw-game-stats-heading">
      <h3>{soccer ? 'Match events' : 'Play timeline'}</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh timeline'}</button>
    </div>
    {soccer && commentary.length > 0 && <div className="cw-timeline-controls" role="group" aria-label="Timeline view">
      <button aria-pressed={!commentarySelected} onClick={()=>setShowCommentary(false)}>Key events</button>
      <button aria-pressed={commentarySelected} onClick={()=>setShowCommentary(true)}>Commentary</button>
    </div>}
    {commentarySelected ? <div className="cw-scoring-plays cw-timeline-plays">
      <p className="cw-game-section-note">{commentary.length} entries · Newest first</p>
      <ol aria-label="Match commentary">
        {commentary.slice(0,visibleCommentary).map(entry=><li key={entry.sequence}>
          <div><p>{entry.description}</p>{entry.clock && <small>{entry.clock}</small>}</div>
        </li>)}
      </ol>
      {commentary.length > visibleCommentary && <button onClick={()=>setVisibleCommentary(count=>count+20)}>Show earlier commentary</button>}
    </div> : plays.length > 0 || scoringOnly || period !== 'all' ? <>
      <div className="cw-timeline-controls">
        <button aria-pressed={scoringOnly} onClick={()=>{setScoringOnly(value=>!value);setVisible(20);}}>{soccer ? 'Goals only' : 'Scoring only'}</button>
        <label htmlFor="cw-timeline-period">Period</label>
        <select id="cw-timeline-period" value={period} onChange={event=>{setPeriod(event.target.value);setVisible(20);}}>
          <option value="all">All periods</option>
          {periods.map(number=><option key={number} value={number}>{number}</option>)}
        </select>
        <span>{filtered.length} {entryLabel}{filtered.length === 1 ? '' : 's'} · Newest first</span>
      </div>
      {!event.timeline?.length && !scoringOnly && <p className="cw-game-section-note">ESPN supplied only scoring plays for this game.</p>}
      {filtered.length > 0 ? <div className="cw-scoring-plays cw-timeline-plays">
        <ol aria-label={soccer ? 'Key match events' : 'Play-by-play'}>
          {filtered.slice(0, visible).map(play=><li key={play.id}>
            {play.side && <TeamMark team={event[play.side]} small/>}
            <div><p>{play.description}</p><small>{[play.period && `Period ${play.period}`, play.clock].filter(Boolean).join(' · ')}</small></div>
            {play.awayScore !== null && play.homeScore !== null && <strong
              aria-label={`${event.away.shortName} ${play.awayScore}, ${event.home.shortName} ${play.homeScore}`}
            >{play.awayScore}–{play.homeScore}</strong>}
          </li>)}
        </ol>
        {filtered.length > visible && <button onClick={()=>setVisible(count=>count+20)}>Show more plays</button>}
      </div> : <p className="cw-game-section-note">No {entryLabel}s match this filter.</p>}
    </> : <p className="cw-game-section-note">{busy ? 'Loading plays…' : event.status === 'scheduled'
      ? 'Play-by-play appears after the game starts when ESPN provides it.'
      : 'ESPN has not provided play-by-play for this game.'}</p>}
  </section>;
}

function PregamePlayers({event}: {event:LiveEvent}) {
  const [category,setCategory] = useState('pointsPerGame');
  const published = event.pregameLeaders ?? [];
  const ordered = ['pointsPerGame','reboundsPerGame','assistsPerGame'].flatMap(key=>{
    const stat = published.find(group=>group.key===key);
    return stat ? [stat] : [];
  });
  const selected = ordered.find(group=>group.key===category) ?? ordered[0];
  if (!selected) return <p className="cw-game-section-note">ESPN hasn’t supplied a pregame player preview for this matchup.</p>;
  return <>
    <p className="cw-game-section-note">Season averages per game from ESPN.</p>
    <div className="cw-timeline-controls cw-player-controls" role="group" aria-label="Player stat category">
      {ordered.map(stat=><button key={stat.key} aria-pressed={stat.key===selected.key} onClick={()=>setCategory(stat.key)}>{stat.label}</button>)}
    </div>
    <div className="cw-pregame-players" aria-label={selected.label + ' per game'} role="group">
      {(['away','home'] as const).map(side=><section key={side} className="cw-pregame-team" aria-label={event[side].name}>
        <h4><TeamMark team={event[side]} small/>{event[side].name}</h4>
        {selected[side].length ? <ul>{selected[side].map(player=><li key={player.id}>
          {player.headshot && <TeamMark team={{name:player.name,shortName:'',logo:player.headshot}} />}
          <div><strong>{player.name}</strong><span>{player.value} {selected.label.toLowerCase()} per game</span></div>
        </li>)}</ul> : <p>No average supplied.</p>}
      </section>)}
    </div>
  </>;
}

function playerStatSortValue(value: string | undefined) {
  if (!value) return null;
  const duration = /^([0-9]{1,3}):([0-5][0-9])$/.exec(value);
  if (duration) return Number(duration[1]) * 60 + Number(duration[2]);
  if (/^[+-]?[0-9]+(?:[.][0-9]+)?%?$/.test(value)) return Number(value.replace(/%$/, ''));
  return null;
}

function PlayerBoxScore({event, busy, scheduled, onRefresh}: {
  event: LiveEvent;
  scheduled: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [selection, setSelection] = useState<{side: 'away' | 'home'; group: number}>();
  const [playerQuery, setPlayerQuery] = useState('');
  const [sort, setSort] = useState<{column:number; direction:'descending'|'ascending'} | null>(null);
  const side = selection?.side ?? (event.playerStats?.away.length ? 'away' : 'home');
  const groups = event.playerStats?.[side] ?? [];
  const index = Math.min(selection?.group ?? 0, Math.max(0, groups.length - 1));
  const group = groups[index];
  const caption = group && `${event[side].name} · ${group.name}`;
  const sortable = group?.columns.map((_, column) => group.players.some(player =>
    playerStatSortValue(player.values[column]) !== null,
  )) ?? [];
  const players = group?.players.filter(player=>matchesSearchText(playerQuery,player.name)) ?? [];
  const activeSort = sort && sortable[sort.column] ? sort : null;
  if (activeSort) {
    const {column, direction} = activeSort;
    players.sort((a,b) => {
      const left = playerStatSortValue(a.values[column]);
      const right = playerStatSortValue(b.values[column]);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return direction === 'ascending' ? left - right : right - left;
    });
  }

  function changeSort(column: number) {
    setSort(previous => {
      if (previous?.column !== column) return {column, direction:'descending'};
      return previous.direction === 'descending' ? {column, direction:'ascending'} : null;
    });
  }

  function selectGroup(team: 'away'|'home', group: number) {
    setSelection({side:team, group});
    setSort(null);
  }


  if (scheduled) return <section className="cw-game-section" aria-label="Pregame player leaders">
    <div className="cw-game-stats-heading">
      <h3>Pregame player leaders</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh players'}</button>
    </div>
    {busy && !event.pregameLeaders?.length
      ? <p className="cw-game-section-note">Loading player preview…</p>
      : <PregamePlayers event={event}/>}
  </section>;

  return <section className="cw-game-section" aria-label="Player box score">
    <div className="cw-game-stats-heading">
      <h3>Player box score</h3>
      <button disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh players'}</button>
    </div>
    {event.playerStats && <div className="cw-timeline-controls cw-player-controls">
      <div role="group" aria-label="Team" className="cw-player-teams">
        {(['away', 'home'] as const).map(team=><button key={team} aria-pressed={side === team}
          onClick={()=>selectGroup(team,0)}>{event[team].name}</button>)}
      </div>
      {groups.length > 1 && <>
        <label htmlFor="cw-player-category">Category</label>
        <select id="cw-player-category" value={index}
          onChange={change=>selectGroup(side,Number(change.target.value))}>
          {groups.map((item, position)=><option key={position} value={position}>{item.name}</option>)}
        </select>
      </>}
    </div>}
    {group ? <>
      <label className="cw-player-search">
        <span>Find player</span>
        <input type="search" value={playerQuery} onChange={event=>setPlayerQuery(event.target.value)}/>
      </label>
      <div className="cw-player-table-scroll" role="region" aria-label={caption} tabIndex={0}>
        <table>
          <caption>{caption}</caption>
          <thead><tr><th scope="col">Player</th>{group.columns.map((label, position)=>{
            const direction = activeSort?.column === position ? activeSort.direction : undefined;
            return <th key={position} scope="col" aria-sort={direction}>{sortable[position]
              ? <button className="cw-player-sort" type="button" aria-label={'Sort by ' + label}
                  onClick={()=>changeSort(position)}>{label} <span aria-hidden="true">{direction==='descending'?'↓':direction==='ascending'?'↑':'↕'}</span></button>
              : label}</th>;
          })}</tr></thead>
          <tbody>{players.map(player=><tr key={player.id}>
            <th scope="row">{player.name}</th>
            {player.values.map((value, position)=><td key={position}>{value || '—'}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {players.length === 0 && <p role="status">No players match this search.</p>}
    </> : <p className="cw-game-section-note">{busy ? 'Loading player statistics…' : 'ESPN hasn’t supplied a player box score for this matchup yet.'}</p>}
  </section>;
}

export function EventDetail({games, onGame, onClose, ...props}: Props & {
  games: LiveEvent[];
  onGame: (event: LiveEvent) => void;
  onClose: () => void;
}) {
  const {event} = props;
  const zone = useContext(ScheduleTimeZone);
  const fightCard = event.fight?.cardId;
  const leagueGames = games.filter(game => game.league === event.league && (!fightCard || game.fight?.cardId === fightCard));
  if (!leagueGames.some(game => game.id === event.id)) leagueGames.push(event);
  leagueGames.sort((a, b) => fightCard && a.fight && b.fight
    ? a.fight.order - b.fight.order
    : Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const currentIndex = leagueGames.findIndex(game => game.id === event.id);
  const first = Math.max(0, Math.min(currentIndex - 3, leagueGames.length - 7));
  const nearby = leagueGames.slice(first, first + 7);
  const previous = leagueGames[currentIndex - 1];
  const next = leagueGames[currentIndex + 1];
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    const track = rail.current;
    const current = track?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (!track || !current) return;
    const offset = current.getBoundingClientRect().left - track.getBoundingClientRect().left;
    track.scrollLeft += offset - (track.clientWidth - current.clientWidth) / 2;
  }, [event.id, first]);

  return <Modal title="Game details" onClose={onClose} className="cw-game-dialog">
    {nearby.length > 1 && <>
      <div className="cw-matchup-navigation" role="group" aria-label="Switch matchup">
        <button type="button" aria-label="Previous matchup" title={previous?.name}
          aria-disabled={!previous} onClick={() => { if (previous) onGame(previous); }}>Previous</button>
        <span role="status">{currentIndex + 1} of {leagueGames.length} {fightCard ? 'bouts' : 'matchups'}</span>
        <button type="button" aria-label="Next matchup" title={next?.name}
          aria-disabled={!next} onClick={() => { if (next) onGame(next); }}>Next</button>
      </div>
      <nav ref={rail} className="cw-league-matchups" aria-label={fightCard ? 'Bouts on this card' : `${event.leagueName} matchups`}>
      {nearby.map(game => (
        <button key={game.id} aria-label={game.name} aria-current={game.id === event.id ? 'true' : undefined}
          onClick={() => { if (game.id !== event.id) onGame(game); }}>
          <strong>{game.away.shortName || game.away.name} · {game.home.shortName || game.home.name}</strong>
          <span>{game.status === 'scheduled'
            ? <time dateTime={game.startsAt}>{scheduleTime(game.startsAt,zone)}</time>
            : game.statusText}</span>
        </button>
      ))}
    </nav></>}
    <EventDetailContent key={`${event.league}:${event.id}`} {...props}/>
  </Modal>;
}

const gameSections = [
  {id: 'overview', label: 'Overview'},
  {id: 'score', label: 'Score'},
  {id: 'stats', label: 'Stats'},
  {id: 'players', label: 'Players'},
  {id: 'timeline', label: 'Timeline'},
  {id: 'drives', label: 'Drives'},
  {id: 'matchup', label: 'Matchup'},
  {id: 'lineups', label: 'Lineups'},
  {id: 'standings', label: 'Standings'},
  {id: 'pick', label: 'My pick'},
] as const;
type GameSection = (typeof gameSections)[number]['id'];

function sectionAvailable(section: GameSection, event: LiveEvent) {
  if (section === 'drives') return event.sport === 'football';
  if (section === 'lineups') return event.sport === 'soccer';
  if (section === 'standings') return event.sport === 'soccer' || event.league === 'nba';
  return true;
}

function readGameSection(event: LiveEvent): GameSection {
  const params = new URLSearchParams(window.location.search);
  const sections = params.getAll('section');
  return sections.length === 1
    ? gameSections.find(({id}) => id === sections[0] && sectionAvailable(id,event))?.id ?? 'overview'
    : 'overview';
}

function EventDetailContent({
  event, boardEvent, boardFetchedAt, boardDelayed, ticket, ticketsLoading, ticketsError,
  watching, onWatch, watchDisabled, onPick, picksAvailable = false,
}: Props) {
  const zone = useContext(ScheduleTimeZone);
  const [snapshot, setSnapshot] = useState<LiveEvent | null>(null);
  const [requestedAt, setRequestedAt] = useState(Infinity);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [shareState, setShareState] = useState<'idle'|'copied'|'manual'>('idle');
  const [shareLink, setShareLink] = useState('');
  const shareField = useRef<HTMLInputElement>(null);
  const shareable = /^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(event.id);
  const [section, setSection] = useState<GameSection>(()=>readGameSection(event));
  const [refresh, setRefresh] = useState(0);
  const boardStatus = boardDelayed && boardEvent?.scoreSource !== 'NHL' ? undefined : boardEvent?.status;

  function selectSection(next: GameSection) {
    setSection(next);
    setShareState('idle');
    const url = new URL(window.location.href);
    if (url.searchParams.get('game') !== event.id || url.searchParams.get('league') !== event.league) return;
    if (next === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', next);
    window.history.replaceState({cowboyGameEntry: window.history.state?.cowboyGameEntry === true}, '', url);
  }

  async function copyGameLink() {
    const shareQuery = new URLSearchParams({league: event.league, game: event.id});
    if (section !== 'overview' && section !== 'pick') shareQuery.set('section', section);
    const url = new URL(`/?${shareQuery}`, window.location.origin).href;
    setShareLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setShareState('copied');
    } catch {
      setShareState('manual');
    }
  }

  useEffect(() => {
    if (shareState === 'manual') shareField.current?.select();
  }, [shareState]);

  useEffect(() => {
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let status = event.status;
    let tried = false;
    const url = `/api/sports/event?league=${encodeURIComponent(event.league)}&id=${encodeURIComponent(event.id)}`;
    const shouldPoll = () => status !== 'final' && status !== 'cancelled' && status !== 'postponed' &&
      (status === 'live' || boardStatus === 'live');

    async function load() {
      if (document.hidden || active) return;
      const controller = new AbortController();
      active = controller;
      const startedAt = Date.now();
      setBusy(true);
      try {
        const result = await api<{event?:LiveEvent; stale?:boolean; fallback?:'scoreboard'; lastSuccessAt?:string} & Partial<LiveEvent>>(
          url,{signal:controller.signal}
        );
        if (controller.signal.aborted) return;
        const next = result.event || (result.id ? result as LiveEvent : null);
        if (!next || next.id !== event.id || next.league !== event.league) throw new Error('Event details unavailable.');
        const fallback = result.fallback === 'scoreboard';
        if (!fallback || next.status === 'live') status = next.status;
        const readAt = Date.parse(result.lastSuccessAt ?? '');
        setSnapshot(previous => fallback ? {...previous,...next} : next);
        setRequestedAt(fallback && Number.isFinite(readAt) ? readAt : startedAt);
        setStale(!!result.stale);
        setError(fallback ? 'Game summary unavailable. Showing the last scoreboard update.' : '');
      } catch {
        if (!controller.signal.aborted) setError('Could not refresh event details. Last available data shown.');
      } finally {
        if (!controller.signal.aborted) {
          tried = true;
          active = undefined;
          setBusy(false);
          if (!document.hidden && shouldPoll()) timer = setTimeout(load, LIVE_SCORE_REFRESH_MS);
        }
      }
    }

    function visibilityChanged() {
      clearTimeout(timer);
      if (document.hidden) {
        active?.abort();
        active = undefined;
        setBusy(false);
      } else if (!tried || shouldPoll()) {
        void load();
      }
    }

    document.addEventListener('visibilitychange', visibilityChanged);
    void load();
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      clearTimeout(timer);
      active?.abort();
    };
  }, [event.id, event.league, event.status, boardStatus, refresh]);

  const newerBoard = (!boardDelayed || boardEvent?.scoreSource === 'NHL') && boardFetchedAt &&
    Date.parse(boardFetchedAt) > requestedAt ? boardEvent : undefined;
  const usesSummary = section === 'timeline' || section === 'drives' || section === 'players' || section === 'stats' ||
    section === 'score' || section === 'lineups' || section === 'standings';
  const detail = usesSummary && snapshot ? snapshot : newerBoard ?? snapshot ?? event;
  const venue = snapshot?.venue ?? event.venue;
  const leaders = (snapshot ?? event).leaders ?? [];
  const delayed = snapshot && (usesSummary || !newerBoard) ? stale : boardDelayed;
  const entryPaused = boardDelayed || delayed;
  const boardPosition = !boardDelayed && boardEvent?.status === 'live' &&
    boardEvent.period === detail.period && boardEvent.clock === detail.clock ? boardEvent.footballPosition : undefined;
  const fieldPosition = detail.status === 'live' && !delayed && !error ? boardPosition ?? detail.footballPosition : undefined;
  const hasTotal = detail.status !== 'scheduled' && (detail.away.score !== null || detail.home.score !== null);
  const hasPeriodScores = detail.status !== 'scheduled' && Boolean(detail.away.linescores?.length || detail.home.linescores?.length);
  const showTennisScores = detail.sport === 'tennis' && hasPeriodScores && (detail.status === 'live' || detail.completed);
  const entryOpen = detail.status === 'scheduled' && Date.parse(detail.startsAt) > Date.now();

  return <div className="cw-game-layout">
    <div className="cw-game-header">
      <div className="cw-game-meta">
        <span><SportIcon sport={detail.sport}/>{detail.leagueName}</span>
        <div className="cw-game-actions">
          <button className="cw-game-watch" disabled={watchDisabled} aria-pressed={watching} onClick={onWatch}>
            <StarIcon filled={watching}/>{watching ? 'Watching' : 'Watch game'}
          </button>
          {shareable&&<button className="cw-game-copy" onClick={()=>void copyGameLink()}>Copy game link</button>}
        </div>
      </div>
      <div className="cw-game-scoreboard">
        {(['away', 'home'] as const).map(side => (
          <div key={side} className={`cw-game-team cw-game-${side}`}>
            <TeamMark team={{...detail[side], logo: detail[side].logo || event[side].logo}}/>
            <span>{detail[side].name}</span>
            {showTennisScores ? <BoardScore event={detail} side={side}/> : hasTotal && <strong>{detail[side].score ?? '—'}</strong>}
            {detail.fight?.records[side] && <small className="cw-fighter-record"><span className="sr-only">Fighter record, wins losses draws: </span>{detail.fight.records[side]}</small>}
            {detail.soccerAggregate?.advances===side && <small className="cw-result-winner">Advances</small>}
            {(showTennisScores || detail.fight || (!detail.soccerAggregate?.advances && detail.shootoutScores)) &&
              detail.completed && detail.winner===side && <small className="cw-result-winner">Winner</small>}
          </div>
        ))}
        <div className="cw-game-status">
          <strong className={detail.status === 'live' ? 'cw-live-label' : undefined}>{detail.status === 'scheduled' ? 'Upcoming' : detail.winner === 'draw' ? 'Full-time draw' : detail.statusText}</strong>
          <span>{detail.status === 'scheduled'
            ? scheduleTime(detail.startsAt,zone)
            : detail.clock}</span>
          {detail.scoreSource === 'NHL' && <span>NHL backup score</span>}
          {detail.shootoutScores && <span>Penalties {detail.shootoutScores.away}–{detail.shootoutScores.home}</span>}
          {detail.soccerAggregate && <span>Aggregate {detail.soccerAggregate.away}–{detail.soccerAggregate.home} · Leg {detail.soccerAggregate.leg} of {detail.soccerAggregate.totalLegs}</span>}
        </div>
      </div>
      {detail.fight && <div className="cw-fight-summary">
        <strong>{detail.fight.cardName}</strong>
        <span>{[detail.fight.weightClass,detail.fight.rounds && `${detail.fight.rounds} scheduled rounds`,detail.fight.location].filter(Boolean).join(' · ')}</span>
      </div>}
      {fieldPosition && <FootballField event={detail} position={fieldPosition}/>}
      {venue && <p className="cw-game-venue">{venue}</p>}
    </div>
    <div className="cw-game-body">
    {shareState==='copied' && <p className="cw-field-hint" role="status">Game link copied.</p>}
    {shareState==='manual' && <label className="cw-game-share-field">
      Game link
      <input ref={shareField} readOnly value={shareLink} />
    </label>}
    {busy && <p className="cw-field-hint" role="status">Refreshing from source…</p>}
    {error && <p className="cw-form-error" role="alert">{error}</p>}
    {delayed && <p className="cw-form-error" role="status">Source data is delayed. Scores may be out of date.</p>}
    <nav className="cw-game-tabs" aria-label="Game center sections">
      {gameSections.filter(({id})=>sectionAvailable(id,detail)).map(({id, label}) =>
        <button key={id} aria-pressed={section===id} onClick={()=>selectSection(id)}>{detail.fight && id==='score' ? 'Result' : label}</button>
      )}
    </nav>
    {section === 'overview' && hasPeriodScores && !showTennisScores && <PeriodScores event={detail}/>}
    {section === 'overview' && leaders.length > 0 && <GameLeaders event={detail} leaders={leaders} summaryOnly/>}
    {section==='overview' && onPick && !ticket && <section className="cw-detail-pick" aria-label="Free pick">
      <h3>{supportsDrawPick(detail.league)?'Predict the full-time result':'Call the winner'}</h3>
      <p className="cw-field-hint">{!entryOpen ? 'Picks are closed for this game' : entryPaused || error ? 'Picks are paused while game data is unavailable' : 'Free pick · Entry closes at game start'}</p>
      <div className={`cw-pick-options ${supportsDrawPick(detail.league) ? 'cw-three-outcomes' : ''}`}>
        {pickSides(detail.league).map(side => (
          <button key={side} disabled={busy || !picksAvailable || entryPaused || !!error || !entryOpen}
            aria-label={`Select ${pickName(detail,side)}`} onClick={() => onPick(side)}>
            {pickName(detail,side)}<small>{side === 'draw' ? 'FULL TIME' : detail.fight ? 'FIGHTER' : side.toUpperCase()}</small>
          </button>
        ))}
      </div>
    </section>}
    {section==='overview' && ticket && <div className="cw-game-section">
      <p>Free pick saved for <strong>{ticket.selection}</strong>.</p>
      <button onClick={()=>selectSection('pick')}>View saved pick</button>
    </div>}
    {section==='overview' && <button className="cw-game-info-toggle" aria-expanded={showInfo} aria-controls="cw-game-info" onClick={() => setShowInfo(!showInfo)}>
      Game information <span aria-hidden="true">{showInfo ? '−' : '+'}</span>
    </button>}
    {section==='overview' && <dl id="cw-game-info" className="cw-detail-facts" hidden={!showInfo}>
      <div><dt>Status</dt><dd>{detail.statusText}</dd></div>
      {detail.clock && <div><dt>Source clock</dt><dd>{detail.clock}</dd></div>}
      {detail.period !== null && detail.period > 0 && <div><dt>{detail.fight ? 'Round' : 'Period'}</dt><dd>{detail.period}</dd></div>}
      <div><dt>Scheduled start</dt><dd><time dateTime={detail.startsAt}>{scheduleTime(detail.startsAt,zone)}</time></dd></div>
    </dl>}
    {section==='score' && (detail.fight ? <section className="cw-game-section" aria-label="Bout result">
      <h3>Bout result</h3>
      {detail.completed && (detail.winner==='away' || detail.winner==='home')
        ? <p><strong>{detail[detail.winner].name}</strong> won.</p>
        : <p>{detail.status==='scheduled' ? 'This bout has not started.' : 'No winner confirmed by ESPN.'}</p>}
      <p className="cw-game-section-note">
        {detail.statusText}{detail.period ? ` · Round ${detail.period}` : ''}{detail.clock ? ` · ${detail.clock}` : ''}
      </p>
      {detail.completed && detail.fight.scorecards && <section className="cw-fight-scorecards" aria-label="Judges’ scores">
        <h4>Judges’ scores</h4>
        <dl className="cw-game-score-list">
          <div><dt>{detail.away.name}</dt><dd>{detail.fight.scorecards.away.join(' · ')}</dd></div>
          <div><dt>{detail.home.name}</dt><dd>{detail.fight.scorecards.home.join(' · ')}</dd></div>
        </dl>
      </section>}
    </section> : <section className="cw-game-section" aria-label="Score summary">
      <h3>Score summary</h3>
      {hasPeriodScores ? <PeriodScores event={detail}/> : hasTotal ? <dl className="cw-game-score-list">
        <div><dt>{detail.away.name}</dt><dd>{detail.away.score ?? '—'}</dd></div>
        <div><dt>{detail.home.name}</dt><dd>{detail.home.score ?? '—'}</dd></div>
      </dl> : <p>{detail.status==='scheduled' ? 'The game has not started.' : 'The source has not provided a score.'}</p>}
      <p className="cw-game-section-note">{detail.statusText}{detail.clock ? ` · ${detail.clock}` : ''}</p>
      <ScoreProgression event={snapshot ?? detail}/>
    </section>)}
    {section==='stats' && <GameStats event={detail} summary={snapshot ?? event} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='players' && <PlayerBoxScore event={detail} scheduled={detail.status==='scheduled' && boardStatus!=='live' && boardStatus!=='final'} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='timeline' && <GameTimeline event={detail} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='drives' && <FootballDrives event={detail} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='matchup' && <Matchup event={detail} matchup={(snapshot ?? event).matchup} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='lineups' && <SoccerLineups event={snapshot ?? event} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='standings' && <GameStandings event={snapshot ?? event} busy={busy} onRefresh={()=>setRefresh(value=>value+1)}/>}
    {section==='pick' && <section className="cw-game-section" aria-label="Saved free pick">
      <h3>My free pick</h3>
      {ticket ? <><p><strong>{ticket.selection}</strong></p><p className="cw-game-section-note">{
        {open:'Awaiting a confirmed result', won:'Correct pick', lost:'Incorrect pick', void:'Voided', cancelled:'Cancelled'}[ticket.status]
      }</p></> : ticketsLoading ? <p role="status">Loading your picks…</p>
        : ticketsError ? <p role="alert">Could not load your picks.</p>
        : <p>No saved pick for this game.</p>}
    </section>}
    <p className="cw-game-source">Scores and status provided by ESPN.{
      section === 'stats' ? ' Statistics are from the last game summary.' :
      section === 'players' ? ' Player data comes from the latest available game summary.' :
      section === 'timeline' ? ' Plays and scores are from the last game summary.' :
      section === 'matchup' ? ' Matchup information is from the last game summary.' : ''
    }</p>
    </div>
  </div>;
}
