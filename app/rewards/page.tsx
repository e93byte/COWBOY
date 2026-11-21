'use client';

import { useEffect, useState } from 'react';
import { api, useAccount, type User } from '../components/AccountPicks';

type Badge = { id: string; label: string; earned: boolean; progress: number; target: number };

function rewardLabel(reason: string) {
  if (reason === 'signup_bonus') return 'Welcome bonus';
  if (reason === 'pick_win') return 'Confirmed correct pick';
  return reason.replaceAll('_', ' ');
}

export default function RewardsPage() {
  const { user, accountLoading } = useAccount();
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
        <p>Sign in to see your token balance and badges.</p>
      </div>
    );
  }

  return (
    <div className="cw-page">
      <h1>Rewards</h1>
      <p className="cw-page-note">Start with 100 tokens and earn 10 for each confirmed correct pick. Tokens have no cash value, cannot be purchased, and are never redeemable for money.</p>
      {error && <p className="cw-form-error" role="alert">{error}</p>}
      {loading ? <p>Loading rewards…</p> : (
        <>
          <section aria-label="Token balance">
            <h2>Tokens</h2>
            <div className="cw-token-balance">
              <span className="cw-token-amount">{tokens?.tokens ?? 0}</span>
              <span>tokens</span>
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
            ) : <p>No token activity yet.</p>}
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
