'use client';

import { useEffect, useState } from 'react';

const ESPN_CDN_HOSTS = new Set([
  'a.espncdn.com',
  'a1.espncdn.com',
  'a2.espncdn.com',
  'a3.espncdn.com',
  'a4.espncdn.com',
]);

function safeLogoUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && ESPN_CDN_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password) return url.href;
  } catch {
    // Invalid or unexpected logo URLs fall back to the team initials.
  }
  return undefined;
}

export function TeamMark({ team, small = false }: {
  team: { name: string; shortName: string; logo?: string };
  small?: boolean;
}) {
  const src = safeLogoUrl(team.logo);
  const [failedSrc, setFailedSrc] = useState<string>();
  useEffect(() => setFailedSrc(undefined), [src]);

  return <span className={`cw-team-mark${small ? ' small' : ''}`} aria-hidden="true">
    {src && failedSrc !== src
      ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)}/>
      : (team.shortName || team.name).slice(0, 4)}
  </span>;
}

export function RankedTeamName({ team }: { team: { name: string; rank?: number } }) {
  return <span className="cw-ranked-team-name">
    {team.rank !== undefined && <small className="cw-team-rank"><span className="sr-only">Rank </span>#{team.rank}</small>}
    {team.name}
  </span>;
}
