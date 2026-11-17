import type {LiveEvent} from '../lib/live-sports';
import {MatchCard} from './MatchCard';

export function SportsGlance({
  event, personalized, liveCount, followedLiveCount, fetchedAt, delayed, onOpen, onWatchlist, onLive,
}: {
  event?: LiveEvent;
  personalized: boolean;
  liveCount: number;
  followedLiveCount: number;
  fetchedAt: string;
  delayed: boolean;
  onOpen: (event: LiveEvent) => void;
  onWatchlist: () => void;
  onLive: () => void;
}) {
  const eventLabel = personalized
    ? event?.status === 'live' ? 'Your live game' : event?.status === 'scheduled' ? 'Your next game' : 'Your latest final'
    : event?.status === 'live' ? 'Live now' : 'Coming up';
  return <section className="cw-glance" aria-label="Sports at a glance">
    <div className="cw-glance-overview">
      <h2>At a glance</h2>
      <p>ESPN · {delayed ? 'Last received' : 'Updated'} <time dateTime={fetchedAt}>
        {new Date(fetchedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}
      </time></p>
      <div className="cw-glance-actions">
        <button onClick={onLive}><strong>{liveCount}</strong> live {liveCount===1?'game':'games'} <span aria-hidden="true">→</span></button>
        <button onClick={onWatchlist} aria-label={followedLiveCount ? `Open Watchlist, ${followedLiveCount} live` : 'Open Watchlist'}>Watchlist {followedLiveCount > 0 && <small>{followedLiveCount} live</small>} <span aria-hidden="true">→</span></button>
      </div>
    </div>
    <div className="cw-glance-match">
      {event ? <>
        <h3>{eventLabel}</h3>
        <MatchCard key={event.league+':'+event.id} event={event} onOpen={onOpen} label={`Glance game: ${event.name}`}/>
      </> : <p>No live or upcoming games in the current feed.</p>}
    </div>
  </section>;
}
