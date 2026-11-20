'use client';

import { useEffect, useState } from 'react';
import { api, useAccount, type User } from '../components/AccountPicks';
import { Modal } from '../components/AccountPicks';
import { CloseIcon, SportIcon } from '../components/SportIcon';
import { scheduleTime } from '../lib/schedule-time';

export type Contest = { id: string; title: string; kind: string; startsAt: string; endsAt: string; league: string | null; status: string; createdAt: string };
export type ContestStanding = { rank: number; username: string; decidedEvents: number; wins: number; accuracy: number };

export default function ContestsPage() {
  const { user, accountLoading } = useAccount();
  const [contests, setContests] = useState<Contest[]>([]);
  const [standings, setStandings] = useState<ContestStanding[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ contests: Contest[] }>('/api/contests');
        if (!cancelled) setContests(data.contests ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load contests.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const join = async (id: string) => {
    setJoining(id);
    try {
      await api('/api/contests', { method: 'POST', body: JSON.stringify({ contestId: id }) });
      setActive(id);
      await loadStandings(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join contest.');
    } finally {
      setJoining(null);
    }
  };

  const loadStandings = async (id: string) => {
    try {
      const data = await api<{ standings: ContestStanding[] }>(`/api/contests/${encodeURIComponent(id)}/standings`);
      setStandings(data.standings ?? []);
    } catch {
      setStandings([]);
    }
  };

  if (accountLoading) return <p>Loading account…</p>;
  if (!user) {
    return (
      <div className="cw-page">
        <h1>Free Contests</h1>
        <p>Sign in to join contests and see the standings.</p>
      </div>
    );
  }

  return (
    <div className="cw-page">
      <h1>Free Contests</h1>
      <p className="cw-page-note">Join a free prediction contest. Ranked by pick accuracy over the contest window. No entry fee, no payout — bragging rights only.</p>
      {error && <p className="cw-form-error" role="alert">{error}</p>}
      {loading ? <p>Loading contests…</p> : (
        <>
          <section aria-label="Open contests">
            <h2>Open contests</h2>
            {contests.length === 0 ? <p>No contests available right now.</p> : (
              <ul className="cw-contest-list">
                {contests.map(c => (
                  <li key={c.id} className={`cw-contest-card ${active === c.id ? 'cw-joined' : ''}`}>
                    <div className="cw-contest-head">
                      <span className="cw-contest-kind">{c.kind}</span>
                      <span className={`cw-contest-status cw-status-${c.status}`}>{c.status}</span>
                    </div>
                    <h3>{c.title}</h3>
                    <p><time dateTime={c.startsAt}>{new Date(c.startsAt).toLocaleString()}</time> · {leagueLabel(c)}</p>
                    {active === c.id ? (
                      <p>Joined. View standings below.</p>
                    ) : (
                      <button className="cw-primary" disabled={joining === c.id} onClick={() => void join(c.id)}>
                        {joining === c.id ? 'Joining…' : 'Join contest'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {active && (
            <section aria-label="Contest standings">
              <h2>Standings · {contests.find(c => c.id === active)?.title}</h2>
              {standings.length === 0 ? <p>No ranked entries yet. Join and settle at least five picks to appear.</p> : (
                <table className="cw-standings">
                  <thead><tr><th>Rank</th><th>Username</th><th>Decided</th><th>Wins</th><th>Accuracy</th></tr></thead>
                  <tbody>
                    {standings.map(s => (
                      <tr key={s.username}>
                        <td>#{s.rank}</td><td>{s.username}</td><td>{s.decidedEvents}</td><td>{s.wins}</td><td>{(s.accuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function leagueLabel(c: Contest) {
  return c.league ? `${c.league} only` : 'All leagues';
}
