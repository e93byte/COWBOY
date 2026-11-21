// Canonical live-state and clock contract.
//
// LiveEvent.status is deliberately coarse ('scheduled' | 'live' | 'final' |
// 'postponed' | 'cancelled' | 'unknown'). This module derives the finer
// user-facing state and clock integrity metadata WITHOUT inventing data:
//   - clock state is 'running' only while the provider reports the event
//     in-progress; 'stopped' at final; 'unknown' otherwise.
//   - freshness age is measured from the board's fetchedAt (or caller now),
//     never from fabricated provider timestamps.
//   - a frozen provider clock with HTTP 200 is indistinguishable from a live
//     one — callers must use freshness.ageMs + stale to detect it.

export type CanonicalLiveState =
  | 'scheduled' | 'pregame' | 'live' | 'halftime' | 'intermission'
  | 'delayed' | 'postponed' | 'suspended' | 'final' | 'cancelled' | 'unknown';

export type ClockState = 'running' | 'stopped' | 'unknown';

export type LiveClockContract = {
  /** Provider clock display (e.g. "4:32"), or null when not published. */
  value: string | null;
  period: number | null;
  state: ClockState;
  /** When the underlying board payload was fetched (ISO). */
  fetchedAt: string | null;
  /** Age of the payload in ms at evaluation time. */
  ageMs: number | null;
  /** True when ageMs exceeds the stale threshold. */
  stale: boolean;
};

export type LiveStateContract = {
  state: CanonicalLiveState;
  statusText: string;
  clock: LiveClockContract;
};

const PREGAME_WINDOW_MS = 30 * 60_000;
export const DEFAULT_STALE_AFTER_MS = 30_000; // live boards refresh ~1.5s; 30s = clearly stale

type EventSlice = {
  status: string;
  statusText?: string;
  clock?: string | null;
  period?: number | null;
  startsAt?: string;
};

function detailState(statusText: string | undefined): CanonicalLiveState | null {
  const text = (statusText ?? '').toLowerCase();
  if (!text) return null;
  if (/postponed|delay(ed)?\b|suspended|suspend/.test(text)) {
    if (/postponed/.test(text)) return 'postponed';
    if (/suspend/.test(text)) return 'suspended';
    return 'delayed';
  }
  if (/half ?time|half-time|intermission|intermission|between (periods|quarters|halves)/.test(text)) return 'halftime';
  return null;
}

export function deriveLiveState(
  event: EventSlice,
  options: { fetchedAt?: string | number | null; now?: number; staleAfterMs?: number } = {},
): LiveStateContract {
  const now = options.now ?? Date.now();
  const staleAfter = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const fetchedMs = options.fetchedAt === undefined || options.fetchedAt === null
    ? null
    : typeof options.fetchedAt === 'number' ? options.fetchedAt : Date.parse(options.fetchedAt);
  const ageMs = fetchedMs !== null && Number.isFinite(fetchedMs) ? Math.max(0, now - fetchedMs) : null;
  const stale = ageMs !== null && ageMs > staleAfter;

  const clock: LiveClockContract = {
    value: event.clock ?? null,
    period: event.period ?? null,
    state: 'unknown',
    fetchedAt: fetchedMs !== null && Number.isFinite(fetchedMs) ? new Date(fetchedMs).toISOString() : null,
    ageMs,
    stale,
  };

  let state: CanonicalLiveState;
  switch (event.status) {
    case 'scheduled': {
      const start = Date.parse(event.startsAt ?? '');
      state = Number.isFinite(start) && start - now <= PREGAME_WINDOW_MS && start > now ? 'pregame' : 'scheduled';
      break;
    }
    case 'live': {
      state = detailState(event.statusText) ?? 'live';
      break;
    }
    case 'final': state = 'final'; break;
    case 'postponed': state = 'postponed'; break;
    case 'cancelled': state = 'cancelled'; break;
    default: state = 'unknown';
  }

  // Clock runs only while the event is genuinely in progress. Halftime keeps
  // the last displayed value but is 'stopped' — the period break is not live
  // clock movement. Delayed/postponed/suspended freeze it too.
  if (state === 'live') clock.state = 'running';
  else if (state === 'final' || state === 'halftime' || state === 'intermission'
    || state === 'delayed' || state === 'postponed' || state === 'suspended') clock.state = 'stopped';

  return { state, statusText: event.statusText ?? '', clock };
}
