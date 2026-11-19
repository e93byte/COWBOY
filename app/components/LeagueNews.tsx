'use client';

import { useEffect, useState } from 'react';
import type { NewsArticle } from '../lib/sports-news';

function storyDate(iso: string) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function LeagueNews({ league, name }: { league: string; name: string }) {
  const [articles, setArticles] = useState<NewsArticle[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setArticles(null);
    setOpen(false);
    fetch(`/api/sports/news?league=${encodeURIComponent(league)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (alive && Array.isArray(data?.articles)) setArticles(data.articles); })
      .catch(() => { if (alive) setArticles([]); });
    return () => { alive = false; };
  }, [league]);

  if (!articles?.length) return null;
  return <section className="cw-news" aria-label={`${name} news`}>
    <button type="button" className="cw-news-toggle" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>
      Top stories <small>{articles.length} from ESPN</small>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <ol className="cw-news-list">
      {articles.map(article => <li key={article.id}>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          <strong>{article.headline}</strong>
          {article.description && <p>{article.description}</p>}
          <small>{[article.category, storyDate(article.publishedAt), 'ESPN'].filter(Boolean).join(' · ')}</small>
        </a>
      </li>)}
    </ol>}
    <p className="cw-news-note">Headlines link to ESPN. COWBOY does not republish articles.</p>
  </section>;
}
