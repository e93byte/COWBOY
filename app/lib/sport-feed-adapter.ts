import type { LiveEvent } from './live-sports';
import type { LeagueAvailability, SportsLeague } from './sports-leagues';

/**
 * Server-only boundary for an approved sports-data provider. Provider clients
 * normalize their payload before it reaches the board, picks, or settlement.
 */
export type FeedFreshness = {
  fetchedAt: string;
  sourceUpdatedAt?: string;
  stale: boolean;
};

export type FeedResult = {
  events: LiveEvent[];
  freshness: FeedFreshness;
  availability: Extract<LeagueAvailability, 'live' | 'scheduled' | 'delayed' | 'maintenance'>;
};

export interface SportFeedAdapter {
  readonly id: string;
  readonly label: string;
  supports(league: SportsLeague): boolean;
  getSchedule(league: SportsLeague, at: Date): Promise<FeedResult>;
  getEvent(league: SportsLeague, eventId: string): Promise<LiveEvent | null>;
}

/** A registry deliberately contains no credentials; those stay server-side. */
export class SportFeedRegistry {
  private readonly adapters = new Map<string, SportFeedAdapter>();

  register(adapter: SportFeedAdapter): void {
    if (!adapter.id || this.adapters.has(adapter.id)) throw new Error('Feed adapter id must be unique.');
    this.adapters.set(adapter.id, adapter);
  }

  forLeague(league: SportsLeague): SportFeedAdapter | null {
    return [...this.adapters.values()].find(adapter => adapter.supports(league)) ?? null;
  }
}
