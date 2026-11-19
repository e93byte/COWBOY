'use client';

import { useEffect, useState } from 'react';
import { api } from './AccountPicks';
import type { PickConsensus } from '../lib/pick-consensus';

const CONSENSUS_REFRESH_MS = 60_000;

// Anonymous aggregate of free picks across all COWBOY users. Refetches on an
// interval and whenever `nonce` changes (e.g. after a pick is submitted).
export function usePickConsensus(nonce = 0): PickConsensus {
  const [consensus, setConsensus] = useState<PickConsensus>({});
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const load = () => {
      api<{ consensus?: unknown }>('/api/picks/consensus', { signal: controller.signal })
        .then(data => {
          if (disposed || !data || typeof data.consensus !== 'object' || data.consensus === null) return;
          setConsensus(data.consensus as PickConsensus);
        })
        .catch(() => { /* Consensus is decorative; board data must never depend on it. */ });
    };
    load();
    const timer = setInterval(load, CONSENSUS_REFRESH_MS);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [nonce]);
  return consensus;
}
