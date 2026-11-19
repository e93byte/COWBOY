'use client';

import {useContext, useEffect, useRef, useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {Modal} from './AccountPicks';
import {ScheduleTimeZone} from './ScheduleTimeZone';
import {scheduleTime} from '../lib/schedule-time';

const updateTypes = [
  {id: 'reminder', label: 'Pregame reminders (10 minutes)'},
  {id: 'start', label: 'Game starts'},
  {id: 'score', label: 'Score changes'},
  {id: 'final', label: 'Final scores'},
] as const;
type UpdateType = (typeof updateTypes)[number]['id'];

export type GameMoment = {
  id: string;
  event: LiveEvent;
  type: UpdateType;
  label: string;
  observedAt: string;
};

type QuietHours = {enabled: boolean; start: string; end: string};
type AlertSettings = {types: UpdateType[]; quiet: QuietHours};
const defaultSettings: AlertSettings = {
  types: ['start','score','final'], quiet: {enabled:false,start:'22:00',end:'07:00'},
};
const isClockTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);

function quietAt(now: number, settings: QuietHours) {
  if (!settings.enabled || !now || settings.start === settings.end) return false;
  const date = new Date(now);
  const clock = String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');
  return settings.start < settings.end
    ? clock >= settings.start && clock < settings.end
    : clock >= settings.start || clock < settings.end;
}

type BrowserPermission = NotificationPermission | 'unsupported';

export function useGameAlerts(moments: GameMoment[], scheduled: LiveEvent[], now: number) {
  const [settings, setSettings] = useState(defaultSettings);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  // Notification is browser-only; start as 'unsupported' so SSR and the first
  // client render match, then resolve the real permission after mount.
  const [browser, setBrowser] = useState<BrowserPermission>('unsupported');
  const [browserOptIn, setBrowserOptIn] = useState(false);
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cowboy.gameAlerts') || 'null');
      const types = Array.isArray(saved) ? saved : saved?.types;
      if (Array.isArray(types)) {
        const quiet = saved?.quiet;
        setSettings({
          types: updateTypes.filter(type => types.includes(type.id)).map(type => type.id),
          quiet: isClockTime(quiet?.start) && isClockTime(quiet?.end)
            ? {enabled:quiet.enabled === true,start:quiet.start,end:quiet.end} : defaultSettings.quiet,
        });
      }
      setBrowserOptIn(localStorage.getItem('cowboy.gameAlerts.browser') === '1');
      notified.current = new Set(JSON.parse(localStorage.getItem('cowboy.alerts.notified') || '[]'));
      setBrowser(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    } catch {}
  }, []);

  const browserOn = browserOptIn && browser === 'granted';
  useEffect(() => {
    if (!browserOn || quietAt(now, settings.quiet)) return;
    const fresh = entries.filter(moment => !read.has(moment.id) && !notified.current.has(moment.id)).slice(0, 5);
    if (!fresh.length) return;
    for (const moment of fresh) {
      notified.current.add(moment.id);
      try {
        new Notification(moment.label, { body: moment.event.name, tag: moment.id });
      } catch {}
    }
    try {
      localStorage.setItem('cowboy.alerts.notified', JSON.stringify([...notified.current].slice(-200)));
    } catch {}
    // entries/read/settings are intentionally not deps: dedupe is by moment id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserOn, now]);

  const reminders: GameMoment[] = now && settings.types.includes('reminder')
    ? scheduled.filter(event => {
        const until = Date.parse(event.startsAt) - now;
        return until > 0 && until <= 10 * 60_000;
      }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)).map(event=>({
        id:`${event.league}:${event.id}:reminder:${event.startsAt}`,
        event,type:'reminder',label:'Starts within 10 minutes',observedAt:event.startsAt,
      }))
    : [];
  const entries = [...reminders, ...moments.filter(moment => settings.types.includes(moment.type))];
  function save(next: AlertSettings) {
    setSettings(next);
    try { localStorage.setItem('cowboy.gameAlerts', JSON.stringify(next)); } catch {}
  }
  function toggle(type: UpdateType) {
    const types = settings.types.includes(type)
      ? settings.types.filter(value => value !== type) : [...settings.types, type];
    save({...settings,types});
  }
  function changeQuiet(value: QuietHours) {
    save({...settings,quiet:value});
  }
  function markRead(ids: string[]) {
    setRead(previous => {
      const current = new Set([...reminders,...moments].map(moment => moment.id));
      return new Set([...previous, ...ids].filter(id => current.has(id)));
    });
  }
  async function setBrowserAlerts(on: boolean) {
    if (on && browser !== 'unsupported') {
      const permission = browser === 'granted' ? 'granted' : await Notification.requestPermission();
      setBrowser(permission);
      const enabled = permission === 'granted';
      setBrowserOptIn(enabled);
      try { localStorage.setItem('cowboy.gameAlerts.browser', enabled ? '1' : '0'); } catch {}
    } else if (!on) {
      setBrowserOptIn(false);
      try { localStorage.setItem('cowboy.gameAlerts.browser', '0'); } catch {}
    }
  }
  return {settings, entries, read, quiet:quietAt(now,settings.quiet),
    unread: entries.filter(moment => !read.has(moment.id)).length, toggle, changeQuiet, markRead,
    browser, browserOn, setBrowserAlerts};
}

export function GameMomentList({moments, onGame, read}: {
  moments: GameMoment[];
  onGame: (moment: GameMoment) => void;
  read?: ReadonlySet<string>;
}) {
  const zone = useContext(ScheduleTimeZone);
  return <ul>{moments.map(moment => <li key={moment.id}>
    <button onClick={()=>onGame(moment)}>
      <strong>{moment.label}</strong>
      <span>{moment.event.name}</span>
      {moment.type === 'reminder' ? <small>Kickoff · <time dateTime={moment.event.startsAt}>{scheduleTime(moment.event.startsAt,zone)}</time></small> : <small>
        {moment.event.away.score !== null && moment.event.home.score !== null &&
          `${moment.event.away.shortName} ${moment.event.away.score} · ${moment.event.home.shortName} ${moment.event.home.score} · `}
        <time dateTime={moment.observedAt}>{new Date(moment.observedAt).toLocaleString([], {
          month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
        })}</time>
      </small>}
      {read && !read.has(moment.id) && <span className="cw-alert-unread">Unread</span>}
    </button>
  </li>)}</ul>;
}

export function GameAlertSettings({alerts}: {alerts: ReturnType<typeof useGameAlerts>}) {
  const quiet = alerts.settings.quiet;
  return <>
    <fieldset className="cw-alert-types">
      <legend>Show updates for</legend>
      {updateTypes.map(type => <label key={type.id}>
        <input type="checkbox" checked={alerts.settings.types.includes(type.id)} onChange={()=>alerts.toggle(type.id)}/>
        {type.label}
      </label>)}
    </fieldset>
    <fieldset className="cw-alert-types">
      <legend>Quiet hours</legend>
      <label><input type="checkbox" checked={quiet.enabled}
        onChange={event=>alerts.changeQuiet({...quiet,enabled:event.target.checked})}/>Enable quiet hours</label>
      {quiet.enabled && <>
        <div className="cw-quiet-times">
          <label>Quiet start <input type="time" value={quiet.start} onChange={event=>{
            if (isClockTime(event.target.value)) alerts.changeQuiet({...quiet,start:event.target.value});
          }}/></label>
          <label>Quiet end <input type="time" value={quiet.end} onChange={event=>{
            if (isClockTime(event.target.value)) alerts.changeQuiet({...quiet,end:event.target.value});
          }}/></label>
        </div>
        <p className="cw-field-hint">{alerts.quiet ? 'Quiet hours active. Unread badge paused.' : 'Uses your device time. Updates stay available.'}</p>
        {quiet.start === quiet.end && <p className="cw-form-error">Choose different start and end times.</p>}
      </>}
    </fieldset>
    <fieldset className="cw-alert-types">
      <legend>Device notifications</legend>
      {alerts.browser === 'unsupported' ? <p className="cw-field-hint">This browser does not support notifications.</p> : <>
        <label><input type="checkbox" checked={alerts.browserOn}
          disabled={alerts.browser === 'denied'}
          onChange={event=>void alerts.setBrowserAlerts(event.target.checked)}/>
          Show browser notifications for followed games</label>
        {alerts.browser === 'denied' && <p className="cw-field-hint">Notifications are blocked. Allow them in your browser settings to enable this.</p>}
        {alerts.browserOn && <p className="cw-field-hint">Notifications only appear while COWBOY is open in a tab.</p>}
      </>}
    </fieldset>
  </>;
}

export function GameAlertsDialog({alerts, onGame, onWatchlist, onPreferences, onClose}: {
  alerts: ReturnType<typeof useGameAlerts>;
  onGame: (event: LiveEvent) => void;
  onWatchlist: () => void;
  onPreferences: () => void;
  onClose: () => void;
}) {
  return <Modal title="Followed game updates" onClose={onClose} className="cw-game-alerts">
    <p className="cw-dialog-copy">Updates from your followed games, teams and leagues while COWBOY is open.</p>
    <GameAlertSettings alerts={alerts}/>
    {alerts.entries.length ? <>
      <div className="cw-alert-actions">
        <span role="status">{alerts.unread} unread</span>
        <button disabled={!alerts.unread} onClick={()=>alerts.markRead(alerts.entries.map(moment=>moment.id))}>Mark all as read</button>
      </div>
      <div className="cw-alert-list">
        <GameMomentList moments={alerts.entries} read={alerts.read} onGame={moment=>{
          alerts.markRead([moment.id]);
          onGame(moment.event);
        }}/>
      </div>
    </> : <p className="cw-dialog-copy">No updates from your follows yet.</p>}
    <div className="cw-alert-actions">
      <button className="cw-clear" onClick={onWatchlist}>Open Watchlist</button>
      <button className="cw-clear" onClick={onPreferences}>Preferences</button>
    </div>
  </Modal>;
}
