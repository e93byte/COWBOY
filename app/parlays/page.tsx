'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../components/AccountPicks';
import { api } from '../components/AccountPicks';
import { Modal } from '../components/AccountPicks';
import { RefreshIcon } from '../components/SportIcon';
import { americanOdds } from '../lib/odds';
import { americanToDecimal } from '../lib/parlay';

export default function ParlaysPage() {
  const { user, accountLoading } = useAccount();
  const userId = user?.id;
  const [parlays, setParlays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDialog, setRefreshDialog] = useState(false);

  const loadParlays = useCallback(async (signal?: AbortSignal) => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api<{ parlays: any[] }>('/api/parlay', {signal});
      if (!signal?.aborted) setParlays(res.parlays ?? []);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Failed to load parlays.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadParlays(controller.signal);
    return () => controller.abort();
  }, [loadParlays]);

  async function refreshParlays() {
    if (!user) return;
    setRefreshing(true);
    try {
      await api('/api/parlay/refresh', { method: 'POST' });
      await loadParlays();
      setRefreshDialog(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh parlays.');
    } finally {
      setRefreshing(false);
    }
  }

  if (!user) {
    return (
      <div className="cw-page">
        <h1>My Parlays</h1>
        <p>{accountLoading ? 'Checking your session…' : 'Sign in to view your parlays.'}</p>
        {!accountLoading && <a href="/picks">Back to My picks</a>}
      </div>
    );
  }

  return (
    <div className="cw-page">
      <h1>My Parlays</h1>
      {error && <p className="cw-form-error" role="alert">{error}</p>}
      {loading ? (
        <p>Loading parlays…</p>
      ) : (
        <>
          <p className="cw-page-note">Free parlay picks. Each leg settles independently after the event completes.</p>
          {parlays.length === 0 ? (
            <p>No parlays yet. Build one from the sports board.</p>
          ) : (
            <div className="cw-parlay-list">
              {parlays.map(parlay => (
                <div key={parlay.id} className="cw-parlay-card">
                  <div className="cw-parlay-header">
                    <span className="cw-parlay-id">#{parlay.id.slice(-8)}</span>
                    <span className={`cw-parlay-status cw-status-${parlay.status}`}>{parlay.status}</span>
                    {parlay.settledAt && <span className="cw-parlay-settled">Settled {new Date(parlay.settledAt).toLocaleDateString()}</span>}
                  </div>
                  <div className="cw-parlay-legs">
                    {parlay.legs.map((leg:any, idx:number) => (
                      <div key={idx} className="cw-parlay-leg">
                        <span>{leg.eventName}</span>
                        <span>{leg.market} {leg.side}</span>
                        {leg.line !== null && <span>{leg.line}</span>}
                        <span>{americanOdds(leg.odds)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="cw-parlay-summary">
                    <span>Combined reference odds</span>
                    <strong>{americanOdds(parlay.combinedOdds ?? 0)}</strong>{' · '}<span>Free-play entry</span> <strong>No cash value</strong>
                  </div>
                  {!!parlay.chipStake && <p className="cw-chip-note">{parlay.chipStake.toLocaleString()} chips staked{parlay.combinedOdds ? ` · pays ${Math.round(parlay.chipStake * americanToDecimal(parlay.combinedOdds)).toLocaleString()} chips at ${americanOdds(parlay.combinedOdds)}` : ''}</p>}
                </div>
              ))}
            </div>
          )}
          <button className="cw-primary" onClick={()=>setRefreshDialog(true)} disabled={refreshing || parlays.length===0}>
            {refreshing ? 'Refreshing…' : 'Refresh / Settle Parlays'}
          </button>
          {refreshDialog && (
            <Modal title="Refresh Parlays" onClose={()=>setRefreshDialog(false)} locked={refreshing}>
              <p>Check all open parlays against latest event results and settle any that are decided.</p>
              <button className="cw-primary" disabled={refreshing} onClick={()=>void refreshParlays()}>
                {refreshing ? 'Settling…' : 'Settle Now'}
              </button>
              <button className="cw-clear" onClick={()=>setRefreshDialog(false)}>Cancel</button>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
