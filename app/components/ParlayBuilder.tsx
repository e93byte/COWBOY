'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccountDialog, api, Modal, useAccount, type Selection } from './AccountPicks';
import { ActionIcon, CloseIcon, SportIcon, TabIcon } from './SportIcon';
import { RankedTeamName, TeamMark } from './TeamMark';
import { ScheduleTimeZone } from './ScheduleTimeZone';
import { scheduleTime } from '../lib/schedule-time';
import { LIVE_LEAGUES } from '../lib/sports-leagues';
import { pickName, pickSides, postedPickLine, supportsDrawPick, type PickMarket, type PickSide } from '../lib/pick-outcomes';
import { calculateCombinedOdds, checkCorrelation, validateParlayLegs, americanToDecimal, type ParlayLeg, type ParlayInput } from '../lib/parlay';
import { americanOdds, impliedProbability } from '../lib/odds';
import type { GameOdds } from '../lib/live-sports';

type EventOdds = GameOdds;

export type ParlaySelection = Selection & { odds: number; line: number | null };

function canPick(event: { status: string; startsAt: string }, now: number) {
  return event.status === 'scheduled' && Date.parse(event.startsAt) > now;
}

export function ParlayBuilder({
  selections,
  user,
  disabled,
  pending,
  draftEvents,
  onChoose,
  onChangeMarket,
  onClear,
  onReview,
  onRemove,
  onSignIn,
  onClose,
}: {
  selections: ParlaySelection[];
  user: { id: string; username: string } | null;
  disabled: boolean;
  pending: boolean;
  draftEvents: ReadonlyMap<string, { odds?: EventOdds }>;
  onChoose: (event: { id: string; league: string; leagueName: string; name: string; startsAt: string; sport: string; home: { name: string; shortName: string }; away: { name: string; shortName: string } }, side: PickSide, market: PickMarket, odds: number, line: number | null) => void;
  onChangeMarket: (selection: ParlaySelection, event: { odds?: EventOdds }, side: PickSide, market: PickMarket) => void;
  onClear: () => void;
  onReview: () => void;
  onRemove: (selection: ParlaySelection) => void;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const zone = useContext(ScheduleTimeZone);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showCorrelationWarning, setShowCorrelationWarning] = useState(false);
  const count = selections.length;

  const legsWithOdds: ParlayLeg[] = selections.map((sel) => {
    const event = draftEvents.get(`${sel.event.league}:${sel.event.id}`);
    const market = sel.market ?? 'moneyline';
    let odds = sel.odds;
    let line = sel.line ?? null;
    if (event?.odds && market !== 'moneyline') {
      if (market === 'spread') {
        odds = (sel.side === 'home' ? event.odds.homeSpreadPrice : event.odds.awaySpreadPrice) ?? sel.odds;
        line = postedPickLine(event.odds, sel.side, market);
      } else if (market === 'total') {
        odds = (sel.side === 'over' ? event.odds.overPrice : event.odds.underPrice) ?? sel.odds;
        line = postedPickLine(event.odds, sel.side, market);
      }
    }
    return {
      eventId: sel.event.id,
      league: sel.event.league,
      market,
      side: sel.side,
      line,
      odds: odds ?? 0,
      eventName: sel.event.name,
      startsAt: sel.event.startsAt,
      sport: sel.event.sport ?? '',
    };
  });

  const correlation = checkCorrelation(legsWithOdds);
  const validation = validateParlayLegs(legsWithOdds);
  const combinedOdds = legsWithOdds.length >= 2 ? calculateCombinedOdds(legsWithOdds) : 0;

  useEffect(() => {
    if (correlation.correlatedGroups.length > 0 && !showCorrelationWarning) {
      setShowCorrelationWarning(true);
      const timer = setTimeout(() => setShowCorrelationWarning(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [correlation.correlatedGroups.length]);

  return (
    <div className="cw-slip cw-parlay-slip">
      <div className="cw-slip-heading">
        <h2>{count > 1 ? `Parlay (${count} legs)` : 'Add legs to build parlay'}</h2>
        <span>FREE ENTRY</span>
      </div>
      {count ? (
        <div className="cw-selected">
          {selections.map((selection) => {
            const { event, side, market } = selection;
            const mkt = market ?? 'moneyline';
            const key = `${event.league}:${event.id}`;
            const current = draftEvents.get(key);
            const marketPosted = (option: PickMarket) =>
              option === 'moneyline' || postedPickLine(current?.odds as any, side, option) !== null;
            const legOdds = selections.find(l => l.requestId === selection.requestId)?.odds ?? 0;
            return (
              <div className="cw-draft-pick cw-parlay-leg" key={`${key}:${mkt}`}>
                <span className="cw-kicker">
                  <SportIcon sport={event.sport ?? 'all'} />
                  {event.leagueName} · {mkt === 'moneyline' ? (supportsDrawPick(event.league) ? 'FULL-TIME RESULT' : 'MATCH WINNER') : mkt === 'spread' ? 'SPREAD' : 'TOTAL'}
                </span>
                <h3>{event.name}</h3>
                <div className="cw-market-tabs" role="group" aria-label={`Market for ${event.name}`}>
                  {(['moneyline', 'spread', 'total'] as const).map((option) => (
                    <button
                      type="button"
                      key={option}
                      aria-pressed={mkt === option}
                      disabled={pending || !current || !marketPosted(option) || selections.some((item) => item.requestId !== selection.requestId && item.event.league === event.league && item.event.id === event.id && (item.market ?? 'moneyline') === option)}
                      onClick={() => { if (current && mkt !== option) onChangeMarket(selection, current, pickSides(event.league, option)[0], option); }}
                    >
                      {option === 'moneyline' ? 'Winner' : option === 'spread' ? 'Spread' : 'Total'}
                    </button>
                  ))}
                </div>
                <div className="cw-draft-options" role="group" aria-label={`Selection for ${event.name}`}>
                  {pickSides(event.league, mkt).map((option) => {
                    const line = postedPickLine(current?.odds as any, option, mkt);
                    return (
                      <button
                        type="button"
                        key={option}
                        aria-pressed={side === option}
                        disabled={pending || !current}
                        onClick={() => { if (current && (side !== option || mkt !== 'moneyline')) onChoose({ ...event, sport: event.sport ?? '' }, option, mkt, legOdds, line); }}
                      >
                        {pickName(event, option, 'name', mkt, line)}
                        <small>
                          {option === 'draw' ? 'FULL TIME' : option === 'over' ? 'OVER' : option === 'under' ? 'UNDER' : event.sport === 'mma' ? 'FIGHTER' : option.toUpperCase()}
                          {legOdds && ` · ${americanOdds(legOdds)}`}
                        </small>
                      </button>
                    );
                  })}
                </div>
                <p>
                  <time dateTime={event.startsAt}>{scheduleTime(event.startsAt, zone)}</time>
                  {legOdds && <span className="cw-leg-odds">{americanOdds(legOdds)}</span>}
                </p>
                <button className="cw-clear" disabled={pending} aria-label={`Remove selection for ${event.name}`} onClick={() => { setConfirmClear(false); onRemove(selection); }}>
                  Remove leg
                </button>
              </div>
            );
          })}
          {count > 1 && (
            <div className="cw-draft-clear">
              {confirmClear && <p role="status">Clear all {count} legs?</p>}
              <button type="button" className="cw-clear" disabled={pending} onClick={() => setConfirmClear((v) => !v)}>
                {confirmClear ? 'Keep legs' : 'Clear parlay'}
              </button>
              {confirmClear && <button type="button" className="cw-clear" disabled={pending} onClick={() => { setConfirmClear(false); onClear(); }}>
                Clear all
              </button>}
            </div>
          )}
          {!validation.valid && <p className="cw-form-error" role="alert">{validation.errors.join(', ')}</p>}
          {correlation.correlatedGroups.length > 0 && (
            <details className="cw-correlation-warning" open={showCorrelationWarning}>
              <summary>⚠ Correlation detected — click to dismiss</summary>
              <ul>
                {correlation.correlatedGroups.map((group, idx) => (
                  <li key={idx}>
                    Legs {group.legIndices.map(i => i + 1).join(' & ')}: {group.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="cw-parlay-summary">
            <div className="cw-parlay-odds">
              <span>Combined Odds</span>
              <strong>{combinedOdds > 0 ? americanOdds(combinedOdds) : '—'}</strong>
            </div>
            <div className="cw-parlay-payout"><span>Free-play entry</span><strong>No cash value</strong></div>
          </div>
          {disabled && <p className="cw-form-error" role="status">A leg is paused or locked. Refresh the board or remove the unavailable leg.</p>}
          <button className="cw-primary cw-parlay-review" disabled={disabled || pending || count < 2 || !validation.valid} onClick={user ? onReview : onSignIn}>
            {user ? `Review ${count}-leg parlay` : 'Sign in to save parlay'}
          </button>
        </div>
      ) : (
        <div className="cw-slip-empty">
          <img src="/cowboy-mark.webp" alt="" />
          <h3>Build a Parlay</h3>
          <p>Add 2+ picks from different games.<br />Free picks only. No money on the line.</p>
        </div>
      )}
      <div className="cw-slip-note">Parlays require 2–10 legs. Same-game legs allowed (SGP) but correlated markets are flagged. Each leg settles independently.</div>
    </div>
  );
}

export function ParlayReviewModal({
  selections,
  user,
  pending,
  onConfirm,
  onCancel,
  draftEvents,
  zone,
  chipStake = 0,
  onChipStake,
}: {
  selections: ParlaySelection[];
  user: { id: string; username: string; tokens?: number } | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  draftEvents: ReadonlyMap<string, { odds?: EventOdds }>;
  zone: string;
  chipStake?: number;
  onChipStake?: (amount: number) => void;
}) {
  const legsWithOdds: ParlayLeg[] = selections.map((sel) => {
    const event = draftEvents.get(`${sel.event.league}:${sel.event.id}`);
    const market = sel.market ?? 'moneyline';
    let odds = sel.odds;
    let line = sel.line ?? null;
    if (event?.odds && market !== 'moneyline') {
      if (market === 'spread') {
        odds = (sel.side === 'home' ? event.odds.homeSpreadPrice : event.odds.awaySpreadPrice) ?? sel.odds;
        line = postedPickLine(event.odds, sel.side, market);
      } else if (market === 'total') {
        odds = (sel.side === 'over' ? event.odds.overPrice : event.odds.underPrice) ?? sel.odds;
        line = postedPickLine(event.odds, sel.side, market);
      }
    }
    return {
      eventId: sel.event.id,
      league: sel.event.league,
      market,
      side: sel.side,
      line,
      odds: odds ?? 0,
      eventName: sel.event.name,
      startsAt: sel.event.startsAt,
      sport: sel.event.sport ?? '',
    };
  });

  const combinedOdds = calculateCombinedOdds(legsWithOdds);

  return (
    <Modal title={`${selections.length}-leg Parlay Review`} locked={pending} onClose={onCancel}>
      {selections.map(({ event, side, market, requestId }) => {
        const mkt = market ?? 'moneyline';
        const current = draftEvents.get(`${event.league}:${event.id}`);
        const legData = selections.find(l => l.requestId === requestId);
        const line = legData?.line ?? null;
        const legOdds = legData?.odds ?? 0;
        return (
          <div className="cw-review-pick" key={requestId}>
            <p className="cw-dialog-copy">{event.name}</p>
            <div className="cw-review-selection">
              <small>
                YOUR {mkt === 'spread' ? 'SPREAD PICK' : mkt === 'total' ? 'TOTAL PICK' : 'CALL'}
                {legOdds && ` · ${americanOdds(legOdds)}`}
              </small>
              <strong>{pickName(event, side, 'name', mkt, line)}</strong>
            </div>
            <p className="cw-dialog-copy">{scheduleTime(event.startsAt, zone)}</p>
          </div>
        );
      })}
      <div className="cw-parlay-summary cw-review-summary">
        <div><span>Combined reference odds</span><strong>{americanOdds(combinedOdds)}</strong></div>
        <div><span>Free-play entry</span><strong>No cash value</strong></div>
      </div>
      {user && onChipStake && <div className="cw-chip-stake">
        <div className="cw-chip-stake-head"><span>Play chips</span><strong>{(user.tokens ?? 0).toLocaleString()} chips</strong></div>
        <div className="cw-chip-options" role="group" aria-label="Parlay chip stake">
          {[0,100,250,500,1000].map(amount=><button key={amount} type="button" aria-pressed={chipStake===amount} disabled={pending||(amount>0&&(user.tokens??0)<amount)} onClick={()=>onChipStake(amount)}>{amount===0?'Free':amount.toLocaleString()}</button>)}
        </div>
        {chipStake>0&&<p className="cw-dialog-copy">Stakes {chipStake.toLocaleString()} chips. A winning parlay pays {Math.round(chipStake*americanToDecimal(combinedOdds)).toLocaleString()} chips at the combined reference odds; voided legs adjust or refund. Chips have no cash value.</p>}
      </div>}
      <p className="cw-dialog-copy">Each leg settles independently. All legs must win for parlay to win. Voided legs reduce parlay to remaining legs.</p>
      <button className="cw-primary" disabled={pending} onClick={() => void onConfirm()}>
        {pending ? 'Saving parlay…' : `Confirm ${selections.length}-leg parlay`}
      </button>
      <button className="cw-clear" disabled={pending} onClick={() => void onCancel()}>Cancel review</button>
    </Modal>
  );
}
