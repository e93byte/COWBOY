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
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[sport]||paths.all}</svg>;
}
export function StarIcon({filled=false}:{filled?:boolean}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill={filled?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>;
}
export function RefreshIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/></svg>;}
export function CloseIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>;}
