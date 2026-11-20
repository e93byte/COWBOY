// Display helpers for posted sportsbook lines. Odds are reference context for
// free picks, never a price the app can accept.

export function americanOdds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value > 0 ? `+${value}` : String(value);
}

export function lineValue(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return signed && value > 0 ? `+${value}` : String(value);
}

export function impliedProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 100) return '—';
  const probability = value > 0 ? 100 / (value + 100) : -value / (-value + 100);
  return `${Math.round(probability * 1000) / 10}%`;
}

export function lineMovement(open: number | null | undefined, current: number | null | undefined): string | null {
  if (open === null || open === undefined || current === null || current === undefined) return null;
  if (!Number.isFinite(open) || !Number.isFinite(current) || open === current) return null;
  return `${lineValue(open, true)} → ${lineValue(current, true)}`;
}
