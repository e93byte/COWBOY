// Original COWBOY line drawings. No third-party/operator artwork or icon font.
export function SportIcon({sport}:{sport:string}) {
  const paths:Record<string,React.ReactNode>={
    all:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    basketball:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c7 3 7 9.8 0 12.8M18.4 5.6c-7 3-7 9.8 0 12.8"/></>,
    football:<><path d="M3 15C2 6 10 1 20 4c3 10-2 18-11 17L3 15ZM5 7l12 12M10 10l5-1M11 13l5-1M12 16l5-1"/></>,
    baseball:<><circle cx="12" cy="12" r="9"/><path d="M7 4c6 4 6 12 0 16M17 4c-6 4-6 12 0 16M5 8l3-1M5 16l3 1M19 8l-3-1M19 16l-3 1"/></>,
    hockey:<><path d="m7 3 8 14h6v4h-8L3 5M5 18h4M4 21h5"/><ellipse cx="6" cy="19.5" rx="3" ry="1.5"/></>,
    soccer:<><circle cx="12" cy="12" r="9"/><path d="m12 7 5 4-2 6H9l-2-6 5-4ZM12 3v4M3 11h4M17 11h4M9 17l-3 3M15 17l3 3"/></>,
    tennis:<><ellipse cx="14" cy="9" rx="6" ry="8" transform="rotate(35 14 9)"/><path d="m9 15-6 7M10 5l9 6M8 9l9 6M15 2l-7 11M19 5l-7 11"/></>,
    mma:<><path d="M7 21v-5l-3-5a2 2 0 0 1 3-2l1 2V5a2 2 0 0 1 3 0V4a2 2 0 0 1 3 0v1a2 2 0 0 1 3 0v2a2 2 0 0 1 3 0v6l-3 4v4H7ZM8 17h9M11 5v5M14 5v5M17 7v4"/></>,
    rugby:<><path d="M3 16C4 8 10 3 19 3c2 1 3 3 2 5-2 8-8 13-16 13-2 0-3-3-2-5Z"/><path d="M4 14l5 6M15 4l5 6M4 19 20 5"/></>,
    golf:<><path d="M8 20V3l10 4-10 4M4 21h15"/><circle cx="17" cy="17" r="2"/></>,
    volleyball:<><circle cx="12" cy="12" r="9"/><path d="M5 6c5 1 9 4 11 9M4 14c5-1 10 0 15 4M12 3c-1 4 0 8 4 12"/></>,
    handball:<><circle cx="12" cy="12" r="9"/><path d="M8 4c1 4 4 7 9 8M5 8c3 3 4 7 3 11M16 5c-1 4 0 8 3 11"/></>,
    cricket:<><path d="m7 3 7 7M5 5l7 7M8 16l8-8 3 3-8 8-4 1Z"/><path d="M4 21h16"/></>,
    table_tennis:<><circle cx="9" cy="9" r="5"/><path d="m13 13 7 7M4 20h7"/></>,
    badminton:<><path d="m5 4 7 7M12 11l7 8M4 3l4 1M6 6l4-1M8 8l4-1M10 10l4-1"/></>,
    cycling:<><circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 5-8 4 8m-4-8h5l2 8M9 9h3"/></>,
    motorsport:<><circle cx="12" cy="12" r="9"/><path d="M5 15h14M7 15V9h10v6M9 9V6h6v3M8 18h2m4 0h2"/></>,
    racing:<><path d="M5 20 9 4h6l4 16M7 15h10M8 10h8M9 5l3 4 3-4"/></>,
    racing_formula_1:<><path d="M4 17h16M6 17l3-8h6l3 8M9 9l2-4h4l-1 4M5 20h3m8 0h3"/></>,
    racing_nascar:<><circle cx="12" cy="12" r="9"/><path d="m5 15 5-6 3 6 5-6M6 18h12"/></>,
    racing_harness:<><path d="M4 18h16M7 18l2-8h6l2 8M9 10V6h6v4M8 21h2m4 0h2"/></>,
    racing_thoroughbred:<><path d="M4 17c3-5 6-7 11-6l4 3-3 4H7l-3-1Z"/><path d="m8 18-2 3m9-3 2 3M15 11l2-3 3 1"/></>,
    aussierules:<><ellipse cx="12" cy="12" rx="9" ry="6"/><path d="M5 9c4 2 10 2 14 0M5 15c4-2 10-2 14 0"/></>,
    rugby_league:<><path d="M3 16C4 8 10 3 19 3c2 1 3 3 2 5-2 8-8 13-16 13-2 0-3-3-2-5Z"/><path d="M7 10l10 6M7 16l10-6"/></>,
    field_hockey:<><path d="m7 3 8 14h5v4h-7L3 5M4 21h8"/><circle cx="18" cy="18" r="2"/></>,
    lacrosse:<><path d="M4 21 16 5"/><path d="M15 4c2-2 5 0 5 2s-2 4-4 4l-3-3Z"/><path d="M8 16l4 3"/></>,
    water_polo:<><circle cx="12" cy="9" r="6"/><path d="M4 17c2-2 4 2 8 0s6 2 8 0M4 21c2-2 4 2 8 0s6 2 8 0"/></>,
    darts:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m3 21 7-7M3 21h4"/></>,
    snooker:<><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><path d="m3 21 8-8"/></>,
    esports:<><path d="M6 8h12l3 10H3L6 8Z"/><path d="M8 12v4m-2-2h4m6-1h.1m3 0h.1"/></>,
    boxing:<><path d="M7 21v-7l-3-4a2 2 0 0 1 3-2l2 2V5a2 2 0 0 1 3 0v5m0-5a2 2 0 0 1 3 0v5m0-3a2 2 0 0 1 3 0v6l-3 4v4H7Z"/></>,
    politics:<><path d="M4 20h16M6 20v-8h12v8M4 12l8-8 8 8M9 20v-5h6v5"/></>,
    entertainment:<><path d="m8 4 12 4-4 12-12-4 4-12Z"/><path d="m8 4 8 12M20 8 4 16"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[sport]||paths.all}</svg>;
}
export function StarIcon({filled=false}:{filled?:boolean}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill={filled?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>;
}
export function RefreshIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/></svg>;}
export function CloseIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>;}

export function StatusIcon({status}:{status:string}) {
  const paths:Record<string,React.ReactNode> = {
    live:<><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M7 7a7 7 0 0 0 0 10m10-10a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16m16-16a11 11 0 0 1 0 16"/></>,
    scheduled:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    final:<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    postponed:<><circle cx="12" cy="12" r="9"/><path d="M10 8v8m4-8v8"/></>,
    cancelled:<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></>,
    canceled:<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></>,
    unknown:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.1"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[status] ?? paths.unknown}</svg>;
}

export function ActionIcon({action}:{action:'compare'|'details'|'search'|'alerts'|'picks'|'account'|'share'}) {
  const paths = {
    compare:<><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/></>,
    details:<path d="m9 5 7 7-7 7"/>,
    search:<><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></>,
    picks:<><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z"/><path d="m9 12 2 2 4-4"/></>,
    account:<><circle cx="12" cy="8" r="3.25"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
    share:<><path d="M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2"/></>,
    alerts:<path d="M6 10a6 6 0 0 1 12 0c0 4 2 4 2 6H4c0-2 2-2 2-6Zm4 9a2 2 0 0 0 4 0"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[action]}</svg>;
}

const tabStatusIcons = {
  live: 'live',
  upcoming: 'scheduled',
  open: 'scheduled',
  final: 'final',
  settled: 'final',
  won: 'final',
  lost: 'cancelled',
  void: 'postponed',
  cancelled: 'cancelled',
} as const;

const tabSymbols = {
  featured: <path d="m12 3 2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1Z"/>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 5h2m4 0h2"/></>,
  overview: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></>,
  score: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 9v6M7 10v4m9-4a1 1 0 0 1 2 0v3a1 1 0 0 1-2 0Z"/></>,
  stats: <path d="M4 20h16M7 16v-4m5 4V7m5 9V4"/>,
  players: <><circle cx="10" cy="8" r="3"/><path d="M4 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 2 4v2"/></>,
  props: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5M8 17h3"/></>,
  odds: <><path d="M4 19V5m0 14h16"/><path d="m7 15 4-4 3 2 5-6"/><circle cx="19" cy="7" r="1"/></>,
  timeline: <><path d="M7 4v16m5-14h7m-7 6h7m-7 6h7"/><circle cx="7" cy="6" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/><circle cx="7" cy="18" r="1.5" fill="currentColor"/></>,
  drives: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14m10-14v14M8 12h8m-3-3 3 3-3 3"/></>,
  matchup: <path d="M4 7h16m-4-4 4 4-4 4m4 6H4m4-4-4 4 4 4"/>,
  lineups: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16"/><circle cx="12" cy="12" r="3"/></>,
  standings: <path d="M4 20h16M5 20v-7h5v7m0-11h5v11m0-4h4v4"/>,
  contests: <path d="M4 20h16M7 10v10m4-10v10m4-10v10M3 4h18M7 4v16m4-16v16M15 4v16"/>,
  rewards: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>,
} satisfies Record<string, React.ReactNode>;

type Tab = keyof typeof tabStatusIcons | keyof typeof tabSymbols | 'all' | 'following' | 'watchlist' | 'pick' | 'schedule' | 'contests' | 'parlays' | 'rewards';

export function TabIcon({tab}: {tab: Tab}) {
  if (tab === 'all') return <SportIcon sport="all"/>;
  if (tab === 'following' || tab === 'watchlist') return <StarIcon/>;
  if (tab === 'pick') return <ActionIcon action="picks"/>;
  if (tab in tabStatusIcons) return <StatusIcon status={tabStatusIcons[tab as keyof typeof tabStatusIcons]}/>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{tabSymbols[(tab === 'schedule' ? 'calendar' : tab) as keyof typeof tabSymbols]}</svg>;
}
