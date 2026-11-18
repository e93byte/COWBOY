'use client';

import {useEffect, useState} from 'react';

export type ResponsibleLimits = {dailyPicks: number; pausedUntil: string; excluded: boolean};
export const RESPONSIBLE_KEY = 'cowboy.responsible-play.v1';
export const RESPONSIBLE_DEFAULTS: ResponsibleLimits = {dailyPicks: 5, pausedUntil: '', excluded: false};

export function readResponsibleLimits(): ResponsibleLimits | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RESPONSIBLE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value && typeof value === 'object') return {
      dailyPicks: Number.isInteger(value.dailyPicks) && value.dailyPicks >= 0 && value.dailyPicks <= 20 ? value.dailyPicks : RESPONSIBLE_DEFAULTS.dailyPicks,
      pausedUntil: typeof value.pausedUntil === 'string' ? value.pausedUntil : '',
      excluded: value.excluded === true,
    };
  } catch {}
  return null;
}

export function isSelfExcluded(limits: ResponsibleLimits | null, now = Date.now()): boolean {
  if (!limits) return false;
  if (limits.excluded) return true;
  if (limits.pausedUntil) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (limits.pausedUntil >= today) return true;
  }
  return false;
}

export function ResponsiblePlayTools({onChange}: {onChange?: (next: ResponsibleLimits | null) => void} = {}) {
  const [limits, setLimits] = useState<ResponsibleLimits>(() => readResponsibleLimits() ?? RESPONSIBLE_DEFAULTS);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setLimits(readResponsibleLimits() ?? RESPONSIBLE_DEFAULTS);
  }, []);
  function save(next: ResponsibleLimits) {
    setLimits(next);
    setSaved(true);
    try {
      localStorage.setItem(RESPONSIBLE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event('cowboy-responsible-update'));
    } catch {}
    onChange?.(next);
  }
  return <section aria-labelledby="cw-pref-responsible">
    <h2 id="cw-pref-responsible">Responsible play</h2>
    <p>COWBOY is free-to-play. These browser-local controls help you pause participation and set a daily pick reminder.</p>
    <label>Daily pick reminder limit
      <select aria-label="Daily pick reminder limit" value={limits.dailyPicks} onChange={event => save({...limits, dailyPicks: Number(event.target.value)})}>
        {[0,1,3,5,10,20].map(value => <option key={value} value={value}>{value === 0 ? 'Pause all picks' : `${value} picks`}</option>)}
      </select>
    </label>
    <label>Pause until
      <input type="date" aria-label="Pause until" value={limits.pausedUntil} min={new Date().toISOString().slice(0,10)} onChange={event => save({...limits, pausedUntil: event.target.value})}/>
    </label>
    <label><input type="checkbox" aria-label="Self-exclude from free picks on this browser" checked={limits.excluded} onChange={event => save({...limits, excluded: event.target.checked})}/> Self-exclude from free picks on this browser</label>
    {saved && <p role="status">Responsible-play settings saved on this browser.</p>}
    <p className="cw-field-hint">These controls do not manage money or override server-side eligibility checks.</p>
  </section>;
}
