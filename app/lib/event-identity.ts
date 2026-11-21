// Canonical cross-provider event identity.
//
// COWBOY's canonical event id is the ESPN scoreboard id: `${league}:${id}`.
// Every other provider's identifier is namespaced and mapped onto it:
//   espn:    canonical — already what LiveEvent.id carries
//   toa:     the-odds-api opaque id — matched by team names + commence time
//   kalshi:  event ticker suffix — matched by team names + start window
//   internal: picks store league + espn eventId + homeId/awayId and verify
//             all three on every settlement/refresh before grading.
//
// Matching is deliberately conservative: a candidate must resolve BOTH
// sides unambiguously within a time window. Ambiguous or missing data
// returns null — never a wrong-game association.

export type EventIdentity = {
  /** Canonical ESPN event id (LiveEvent.id). */
  canonicalId: string;
  league: string;
  homeName: string;
  awayName: string;
  startsAt: string;
};

export type ProviderEventRef = {
  provider: 'the-odds-api' | 'kalshi' | 'espn';
  providerId: string;
  homeName: string;
  awayName: string;
  startsAt: string | null;
};

const MATCH_WINDOW_MS = 72 * 3_600_000; // provider clocks drift; same as exchange-odds

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeTeamName(value).split(' ').filter(Boolean));
}

/** Every token of `needle` appears in `haystack` (city ⊂ full team name). */
export function teamNameCovers(needle: string, haystack: string): boolean {
  const n = tokens(needle);
  if (!n.size) return false;
  const h = tokens(haystack);
  for (const token of n) if (!h.has(token)) return false;
  return true;
}

function withinWindow(providerStart: string | null, canonicalStart: string): boolean {
  const target = Date.parse(canonicalStart);
  if (!Number.isFinite(target)) return false;
  const candidate = providerStart ? Date.parse(providerStart) : NaN;
  // Missing provider timestamps can't be time-verified; allow name-only
  // matches only when the name resolution is unambiguous (caller's job to
  // reject ambiguity — this helper reports the time check separately).
  if (!Number.isFinite(candidate)) return true;
  return Math.abs(candidate - target) <= MATCH_WINDOW_MS;
}

export type IdentityMatch = { ref: ProviderEventRef; confidence: 'exact' | 'names' };

/**
 * Resolve a provider event reference to a canonical ESPN event.
 * Returns null on ambiguity — callers must treat null as "no association".
 */
export function matchProviderEvent(
  refs: ProviderEventRef[],
  canonical: EventIdentity,
): IdentityMatch | null {
  const candidates = refs.filter(ref => {
    if (ref.provider === 'espn') return ref.providerId === canonical.canonicalId;
    if (!withinWindow(ref.startsAt, canonical.startsAt)) return false;
    const homeMatch = teamNameCovers(ref.homeName, canonical.homeName) || teamNameCovers(canonical.homeName, ref.homeName);
    const awayMatch = teamNameCovers(ref.awayName, canonical.awayName) || teamNameCovers(canonical.awayName, ref.awayName);
    return homeMatch && awayMatch;
  });
  if (candidates.length !== 1) return null;
  const ref = candidates[0];
  return { ref, confidence: ref.provider === 'espn' ? 'exact' : 'names' };
}

/** Inverse: find the canonical event a provider ref points at, given a board. */
export function resolveCanonicalEvent<T extends { id: string; league: string; name?: string; home?: { name?: string }; away?: { name?: string }; startsAt?: string }>(
  board: T[], league: string, providerId: string,
): T | null {
  return board.find(event => event.league === league && event.id === providerId) ?? null;
}
