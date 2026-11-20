"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { statPercentages } from "../lib/showcase-stats";

type MatchListItem = {
  slug: string; home: string; away: string; homeScore: string | null; awayScore: string | null;
  status: string; statusText: string; time: string | null; competition: string | null;
};
type Stat = { label?: string; home?: number | string; away?: number | string; home_pct?: number; away_pct?: number; suffix?: string };
type Incident = { time?: number; type?: string; side?: string; player?: string; home_score?: number; away_score?: number };
type MatchDetail = MatchListItem & { minute: string | number | null; stats: Stat[]; incidents: Incident[] };
type ListPayload = { matches: MatchListItem[]; fetchedAt: string; sourceUpdatedAt: string | null };
type DetailPayload = { match: MatchDetail; fetchedAt: string; sourceUpdatedAt: string | null };

const REFRESH_MS = 60_000;

function formatTime(value: string | null) {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export default function LiveDataShowcase() {
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedLabel, setUpdatedLabel] = useState("Source updated");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadMatches = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetch("/api/showcase/matches", { cache: "no-store" });
      if (!response.ok) throw new Error("feed");
      const data = await response.json() as ListPayload;
      setMatches(data.matches);
      setUpdatedAt(data.sourceUpdatedAt ?? data.fetchedAt);
      setUpdatedLabel(data.sourceUpdatedAt ? "Source updated" : "Fetched");
      setSelectedSlug((current) => data.matches.some((item) => item.slug === current) ? current : (data.matches.find((item) => item.status === "live") ?? data.matches[0])?.slug ?? "");
      setError("");
    } catch {
      setError("Could not reach the real scores feed. Showing the last successful snapshot if available.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadMatches();
    const timer = window.setInterval(() => void loadMatches(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadMatches]);

  useEffect(() => {
    if (!selectedSlug) return;
    let active = true;
    const loadDetail = async () => {
      try {
        const response = await fetch(`/api/showcase/matches/${encodeURIComponent(selectedSlug)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("detail");
        const data = await response.json() as DetailPayload;
        if (active) {
          setDetail(data.match);
          setUpdatedAt(data.sourceUpdatedAt ?? data.fetchedAt);
          setUpdatedLabel(data.sourceUpdatedAt ? "Source updated" : "Fetched");
          setError("");
        }
      } catch {
        if (active) setError("Match stats could not be refreshed; the card may be showing older data.");
      }
    };
    void loadDetail();
    const timer = window.setInterval(loadDetail, REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedSlug]);

  const selected = useMemo(() => matches.find((match) => match.slug === selectedSlug) ?? null, [matches, selectedSlug]);
  const liveCount = matches.filter((match) => match.status === "live").length;
  const isLive = detail?.status === "live" || selected?.status === "live";

  return <section className="live-data-card" aria-labelledby="live-data-title">
    <div className="live-data-head">
      <div className="live-data-title-wrap"><span className="real-feed-mark"><span /></span><div><p className="eyebrow">REAL SCORES · LIVE MATCH STATS</p><h2 id="live-data-title">Live data showcase <span className="feed-sport">SOCCER</span></h2></div></div>
      <div className="feed-head-actions">{isLive && <span className="real-live-badge"><i /> LIVE</span>}<button className="feed-refresh" onClick={() => void loadMatches(true)} disabled={refreshing}>{refreshing ? "Updating…" : "Refresh"}</button></div>
    </div>
    <div className="live-data-meta"><span>{liveCount ? `${liveCount} live matches in feed` : "No live match at this moment"}</span><span>{updatedLabel} {updatedAt ? formatTime(updatedAt) : "—"} · refreshes about every 60 seconds</span></div>
    {error && <div className="feed-warning" role="status">{error}</div>}
    {loading && !matches.length ? <div className="feed-loading">Connecting to real match data…</div> : matches.length === 0 ? <div className="feed-loading">No score feed data available right now. Retry in a moment.</div> : <>
      <label className="match-picker-label" htmlFor="match-picker">Match</label>
      <select id="match-picker" className="match-picker" value={selectedSlug} onChange={(event) => setSelectedSlug(event.target.value)}>
        {matches.map((match) => <option value={match.slug} key={match.slug}>{match.status === "live" ? "LIVE · " : ""}{match.away} @ {match.home} · {match.competition ?? "Competition unavailable"}</option>)}
      </select>
      <div className="real-scoreboard">
        <div className="real-team"><span className="real-team-mark">{(detail?.away ?? selected?.away ?? "A").slice(0, 1)}</span><div><strong>{detail?.away ?? selected?.away}</strong><small>Away</small></div></div>
        <div className="real-score-center"><div className="real-score-line"><b>{detail?.awayScore ?? selected?.awayScore ?? "—"}</b><span>:</span><b>{detail?.homeScore ?? selected?.homeScore ?? "—"}</b></div><span className={isLive ? "real-status-live" : "real-status-other"}>{isLive && <i />}{detail?.statusText ?? selected?.statusText ?? "Status unavailable"}{detail?.minute ? ` · ${detail.minute}′` : ""}</span><small>{detail?.competition ?? selected?.competition ?? "Competition unavailable"}</small></div>
        <div className="real-team real-team-home"><span className="real-team-mark">{(detail?.home ?? selected?.home ?? "H").slice(0, 1)}</span><div><strong>{detail?.home ?? selected?.home}</strong><small>Home</small></div></div>
      </div>
      <div className="real-stats-title"><strong>Match stats</strong><span>Home vs away</span></div>
      {detail?.stats?.length ? <div className="real-stats-list">{detail.stats.map((stat, index) => {
        const percentages = statPercentages(stat);
        return <div className="real-stat-row" key={`${stat.label ?? "stat"}-${index}`}><div className="real-stat-values"><b>{stat.away ?? "—"}{stat.away != null ? stat.suffix ?? "" : ""}</b><span>{stat.label ?? "Stat"}</span><b>{stat.home ?? "—"}{stat.home != null ? stat.suffix ?? "" : ""}</b></div>{percentages && <div className="stat-track"><span className="stat-away" style={{ width: `${percentages.away}%` }} /><span className="stat-home" style={{ width: `${percentages.home}%` }} /></div>}</div>;
      })}</div> : <div className="feed-loading compact">Detailed statistics haven’t arrived for this match yet.</div>}
      {!!detail?.incidents?.length && <div className="real-incidents"><strong>Key moments</strong>{detail.incidents.slice(0, 3).map((incident, index) => <div className="real-incident" key={`${incident.time}-${incident.type}-${index}`}><span>{incident.time ? `${incident.time}′` : "EVENT"}</span><b>{incident.type ?? "Match event"}</b><span>{incident.player ?? ""}</span><span className="incident-score">{incident.home_score ?? ""}–{incident.away_score ?? ""}</span></div>)}</div>}
      <a className="sportscore-credit" href="https://sportscore.com/" rel="dofollow" title="Sports data by SportScore">Powered by SportScore <span>↗</span></a>
    </>}
    <p className="feed-disclaimer">Public third-party soccer scores and stats. Coverage and update timing depend on the source; odds are not provided here.</p>
  </section>;
}
