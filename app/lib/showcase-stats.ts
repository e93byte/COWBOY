export type ShowcaseStat = {
  home?: number | string;
  away?: number | string;
  home_pct?: number;
  away_pct?: number;
};

function statNumber(value: number | string | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function statPercentages(stat: ShowcaseStat): { home: number; away: number } | null {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const homeExplicit = typeof stat.home_pct === "number" && Number.isFinite(stat.home_pct) ? clamp(stat.home_pct) : null;
  const awayExplicit = typeof stat.away_pct === "number" && Number.isFinite(stat.away_pct) ? clamp(stat.away_pct) : null;
  if (homeExplicit !== null || awayExplicit !== null) {
    const home = homeExplicit ?? 100 - awayExplicit!;
    const away = awayExplicit ?? 100 - homeExplicit!;
    return { home, away };
  }
  const home = statNumber(stat.home);
  const away = statNumber(stat.away);
  if (home === null || away === null || home + away <= 0) return null;
  const homePct = Math.round(100 * home / (home + away));
  return { home: homePct, away: 100 - homePct };
}