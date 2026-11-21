'use client';

import { useEffect, useState } from 'react';
import { api, useAccount, type User } from '../components/AccountPicks';

type Badge = { id: string; label: string; earned: boolean; progress: number; target: number };
type Ticket = { status: string; startsAt: string };

function pickStreaks(tickets: Ticket[]) {
  const results = tickets
    .filter(t => (t.status === 'won' || t.status === 'lost') && Number.isFinite(Date.parse(t.startsAt)))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  let current = 0;
  if (results[0]) {
    const latest = results[0].status;
    for (const ticket of results) {
      if (ticket.status !== latest) break;
      current++;
    }
  }
  let best = 0, run = 0;
  for (const ticket of results) {
    run = ticket.status === 'won' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best, hot: results[0]?.status === 'won' ? current : 0 };
}

function rewardLabel(reason: string) {
  if (reason === 'signup_bonus') return 'Welcome bonus';
  if (reason === 'pick_win') return 'Confirmed correct pick';
  if (reason === 'chip_stake') return 'Chip stake';
  if (reason === 'chip_stake_refund') return 'Stake refund';
  if (reason === 'chip_win') return 'Chip payout';
  if (reason === 'chip_refund') return 'Chip refund';
  return reason.replaceAll('_', ' ');
}

export default function RewardsPage() {
  const { user, accountLoading, tickets } = useAccount();
  const [tokens, setTokens] = useState<{ tokens: number; ledger: Array<{amount:number;reason:string;at:string}> } | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, b] = await Promise.all([
          api<{ tokens: number; ledger: Array<{amount:number;reason:string;at:string}> }>('/api/account/tokens'),
          api<{ badges: Badge[] }>('/api/account/badges'),
        ]);
        if (!cancelled) { setTokens(t); setBadges(b.badges); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load rewards.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (accountLoading) return <p>Loading account…</p>;
  if (!user) {
    return (
      <div className="cw-page">
        <h1>Rewards</h1>
        <p>Sign in to see your chip balance and badges.</p>
      </div>
    );
  }

  return (
    <div className="cw-page">
      <h1>Rewards</h1>
      <p className="cw-page-note">Start with 5,000 play chips and earn 10 for each confirmed correct pick. Stake chips on picks and parlays for bigger chip payouts at the posted odds. Chips have no cash value, cannot be purchased, and are never redeemable for money.</p>
      {user && tickets.length > 0 && (() => {
        const streaks = pickStreaks(tickets);
        return streaks.best > 0 ? <p className="cw-page-note" role="status">
          {streaks.hot > 0
            ? <>On a <strong>{streaks.hot}-pick win streak</strong> — best run: {streaks.best}.</>
            : <>Best win streak: <strong>{streaks.best}</strong> picks.</>}
        </p> : null;
      })()}
      {error && <p className="cw-form-error" role="alert">{error}</p>}
      {loading ? <p>Loading rewards…</p> : (
        <>
          <section aria-label="Chip balance">
            <h2>Chips</h2>
            <div className="cw-token-balance">
              <span className="cw-token-amount">{tokens?.tokens ?? 0}</span>
              <span>chips</span>
            </div>
            <p>Your referral code: <strong>{user.referralCode}</strong> <span className="cw-note">Share it so friends can join under your referral.</span></p>
            {tokens?.ledger.length ? (
              <table className="cw-ledger">
                <thead><tr><th>Amount</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>
                  {tokens.ledger.slice(0, 20).map((e, i) => (
                    <tr key={i}>
                      <td>{e.amount > 0 ? '+' : ''}{e.amount}</td>
                      <td>{rewardLabel(e.reason)}</td>
                      <td><time dateTime={e.at}>{new Date(e.at).toLocaleDateString()}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No chip activity yet.</p>}
          </section>
          <section aria-label="Badges">
            <h2>Badges</h2>
            <div className="cw-badges">
              {badges.map(b => (
                <div key={b.id} className={`cw-badge ${b.earned ? 'cw-badge-earned' : 'cw-badge-locked'}`}>
                  <span className="cw-badge-icon">{b.earned ? '🏆' : '⭕'}</span>
                  <div>
                    <strong>{b.label}</strong>
                    <span>{b.progress} / {b.target}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
