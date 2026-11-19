'use client';

import { useEffect, useState } from 'react';
import type { LeagueFutures } from '../lib/futures-markets';

export default function LeagueFuturesPanel({ league, name }: { league: string; name: string }) {
  const [futures, setFutures] = useState<LeagueFutures | null>(null);

  useEffect(() => {
    let alive = true;
    setFutures(null);
    fetch(`/api/sports/futures?league=${encodeURIComponent(league)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (alive && data?.futures?.boards?.length) setFutures(data.futures); })
      .catch(() => {});
    return () => { alive = false; };
  }, [league]);

  if (!futures?.boards.length) return null;
  return <section className="cw-futures" aria-label={`${name} futures markets`}>
    <h3>Futures <small>{futures.book} implied probabilities · reference only</small></h3>
    {futures.boards.map(board => <div className="cw-futures-board" key={board.title}>
      <h4>{board.title}</h4>
      <ol className="cw-futures-list">
        {board.outcomes.map(outcome => <li key={outcome.name}>
          <span>{outcome.name}</span>
          <strong>{Math.round(outcome.probability * 100)}%</strong>
        </li>)}
      </ol>
    </div>)}
  </section>;
}
