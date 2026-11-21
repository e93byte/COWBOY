'use client';

import {ActionIcon} from './SportIcon';
import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { LiveBoard, LiveEvent } from '../lib/live-sports';

type League = Pick<LiveBoard['leagues'][number], 'id' | 'name'>;
export type Follow = { id: string; name: string; league: string };
export type BoardSuggestion =
  | { kind: 'league'; id: string; name: string }
  | { kind: 'team'; id: string; name: string; league: string; leagueName: string }
  | { kind: 'tournament'; id: string; name: string; league: string; leagueName: string }
  | { kind: 'game'; id: string; name: string; event: LiveEvent };

function words(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matches(tokens: string[], value: string) {
  const normalized = words(value);
  return tokens.every(token => normalized.includes(token));
}

export function matchesBoardQuery(event: LiveEvent, query: string) {
  return matchesSearchText(query, [
    event.name, event.leagueName, event.league, event.away.name, event.away.shortName, event.home.name, event.home.shortName,
  ].join(' '));
}

export function matchesSearchText(query: string, value: string) {
  return matches(words(query).split(' ').filter(Boolean), value);
}

export function boardTournamentName(event: LiveEvent) {
  if (event.sport !== 'tennis' && event.sport !== 'mma') return;
  const separator = event.name.indexOf(' — ');
  return separator >= 0 ? event.name.slice(separator + 3).trim() || undefined : undefined;
}

function suggestionsFor(events: readonly LiveEvent[], leagues: readonly League[], query: string) {
  const value = words(query);
  if (value.length < 2) return [];
  const tokens = value.split(' ');
  const results = new Map<string, { item: BoardSuggestion; order: number }>();
  function add(item: BoardSuggestion, search: string, priority: number) {
    if (!matches(tokens, search)) return;
    const label = words(item.name);
    const order = (label === value || search.toLowerCase() === value ? 0 : label.startsWith(value) ? 2 : 4) + priority;
    const key = item.kind + ':' + item.id;
    if (!results.has(key)) results.set(key, { item, order });
  }
  for (const league of leagues) {
    add({kind:'league', id:league.id, name:league.name}, league.name + ' ' + league.id, 0);
  }
  for (const event of events) {
    const kind = event.sport === 'tennis' || event.sport === 'mma' ? 'tournament' : null;
    const tournament = boardTournamentName(event);
    if (tournament) add({
      kind:'tournament', id:event.league + ':' + tournament, name:tournament, league:event.league, leagueName:event.leagueName,
    }, tournament, 1);
    for (const team of [event.away, event.home]) {
      if (!kind) add({
        kind:'team', id:event.league + ':' + team.id, name:team.name, league:event.league, leagueName:event.leagueName,
      }, team.name + ' ' + team.shortName, 1);
    }
    add({
      kind:'game', id:event.league + ':' + event.id, name:event.name, event,
    }, [event.name, event.leagueName, event.league, event.away.name, event.away.shortName, event.home.name, event.home.shortName].join(' '), 2);
  }
  return [...results.values()].sort((a,b)=>a.order-b.order).slice(0,7).map(row=>row.item);
}

export function BoardSearch({events, leagues, query, onChange, onSelect}: {
  events: readonly LiveEvent[];
  leagues: readonly League[];
  query: string;
  onChange: (value: string) => void;
  onSelect: (item: BoardSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions = useMemo(()=>suggestionsFor(events, leagues, query),[events, leagues, query]);
  const visible = open && suggestions.length > 0;

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && visible) {
      event.preventDefault();
      input.current?.focus();
      setOpen(false);
      return;
    }
    if (!visible || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-suggestion]')];
    const current = options.indexOf(event.target as HTMLButtonElement);
    const next = current < 0
      ? event.key === 'ArrowDown' ? 0 : options.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    event.preventDefault();
    options[next]?.focus();
  }

  return <div className="cw-board-search" onKeyDown={navigate} onBlur={event=>{
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="cw-search">
      <span className="sr-only">Search teams, leagues or games</span>
      <ActionIcon action="search"/>
      <input ref={input} type="search" placeholder="Find a team, league or game" value={query}
        aria-controls={visible ? listId : undefined} autoComplete="off"
        onFocus={()=>setOpen(true)} onChange={event=>{onChange(event.target.value);setOpen(true);}}/>
    </label>
    {visible && <ul id={listId} className="cw-search-suggestions" aria-label="Search suggestions">
      {suggestions.map(item=><li key={item.kind + ':' + item.id}>
        <button data-suggestion onClick={()=>{
          if (item.kind==='game') input.current?.focus();
          setOpen(false);
          onSelect(item);
        }}>
          <span>{item.name}</span>
          <small>{item.kind === 'game' ? item.event.leagueName + ' game' : item.kind === 'league'
            ? 'League' : item.leagueName + (item.kind === 'team' ? ' team' : ' event series')}</small>
        </button>
      </li>)}
    </ul>}
  </div>;
}
