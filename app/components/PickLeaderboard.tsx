'use client';

import { useEffect, useState } from 'react';

type Entry = { rank: number; username: string; decidedEvents: number; wins: number; accuracy: number };
type User = { id: string; username: string; leaderboardOptIn?: boolean } | null;

export default function PickLeaderboard({user,onAccount}: {user: User; onAccount: () => void}) {
  const [entries,setEntries] = useState<Entry[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [enabled,setEnabled] = useState(false);
  const [saving,setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/api/leaderboard',{cache:'no-store'})
      .then(async response => {
        if (!response.ok) throw new Error('Leaderboard is temporarily unavailable.');
        return response.json() as Promise<{entries?:unknown}>;
      })
      .then(data => {
        if (!Array.isArray(data.entries) || !data.entries.every(entry => entry && typeof entry === 'object' &&
          Number.isInteger((entry as Entry).rank) && typeof (entry as Entry).username === 'string' &&
          Number.isInteger((entry as Entry).decidedEvents) && Number.isInteger((entry as Entry).wins) &&
          typeof (entry as Entry).accuracy === 'number')) throw new Error('Leaderboard data is unavailable.');
        if (active) { setEntries(data.entries as Entry[]); setError(''); }
      })
      .catch(() => { if (active) setError('Leaderboard is temporarily unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  },[]);

  useEffect(() => {
    let active = true;
    setEnabled(user?.leaderboardOptIn === true);
    if (user) fetch('/api/account/leaderboard',{cache:'no-store'})
      .then(async response => response.ok ? response.json() as Promise<{enabled:boolean}> : null)
      .then(data => { if (active && data) setEnabled(data.enabled); })
      .catch(() => undefined);
    return () => { active = false; };
  },[user?.id,user?.leaderboardOptIn]);

  async function toggle() {
    if (!user) { onAccount(); return; }
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/account/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!enabled})});
      const data = await response.json() as {enabled?:boolean;message?:string};
      if (!response.ok || typeof data.enabled !== 'boolean') throw new Error(data.message || 'Could not update leaderboard settings.');
      setEnabled(data.enabled);
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setSaving(false); }
  }

  return <section className="cw-feature-panel cw-pick-leaderboard" aria-labelledby="cw-pick-leaderboard-title">
    <div className="cw-feature-heading"><div><p className="cw-kicker">SOURCE-GRADED FREE PICKS</p><h2 id="cw-pick-leaderboard-title">Pick leaderboard</h2></div><span className="cw-feature-badge">OPT-IN</span></div>
    <p className="cw-feature-note">Accuracy across distinct games with confirmed results. Rankings appear only after 10 decided games. No stakes, tokens, or prizes.</p>
    {user ? <div className="cw-leaderboard-optin"><span>{enabled?'Your profile is public on this ranking.':'Your profile is hidden from the ranking.'}</span><button type="button" disabled={saving} aria-pressed={enabled} onClick={()=>void toggle()}>{saving?'Saving…':enabled?'Opt out':'Opt in'}</button></div>
      : <button className="cw-leaderboard-optin-button" type="button" onClick={onAccount}>Sign in to opt in</button>}
    {error && <p role="status" className="cw-feature-note">{error}</p>}
    {loading ? <p className="cw-feature-note" role="status">Loading verified rankings…</p>
      : entries.length ? <ol className="cw-leaderboard-list">{entries.map(entry=><li key={`${entry.rank}:${entry.username}`}>
        <span className="cw-leaderboard-rank">{entry.rank}</span><strong>{entry.username}</strong>
        <span>{entry.wins} / {entry.decidedEvents} wins</span><b>{(entry.accuracy*100).toFixed(1)}%</b>
      </li>)}</ol>
      : <p className="cw-feature-note">Rankings appear when opted-in players have at least 10 games with confirmed outcomes.</p>}
  </section>;
}