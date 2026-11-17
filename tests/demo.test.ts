import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, quote, events, markets, accept, settle, advance, buy, sell, resolve } from '../app/lib/demo';
test('prediction contracts have separate funds, sell bids and idempotent resolution', () => {
 const s = initialState();
 assert.throws(() => buy(s, 'yes', 0, 'bad'), /quantity/i);
 assert.throws(() => buy(s, 'yes', 1000, 'bad'), /balance/i);
 const a = buy(s, 'yes', 10, 'p1');
 assert.equal(a.predictionBalance, 194); assert.equal(a.sportsBalance, 500);
 assert.throws(() => buy(a, 'no', 1, 'p1'), /duplicate/i);
 const b = sell(a, 'p1'); assert.equal(b.predictionBalance, 199.5);
 assert.throws(() => sell(b, 'p1'), /position/i);
 const c = resolve(buy(s, 'yes', 10, 'p2'));
 assert.equal(c.predictionBalance, 204); assert.equal(c.positions.length, 0);
 assert.throws(() => resolve(c), /resolved/i);
 assert.throws(() => buy(c, 'no', 1, 'closed'), /resolved/i);
});
test('sports quote validates stake and rejects correlated event selections', () => {
 const s = initialState();
 assert.throws(() => quote(s, [], 10), /selection/i);
 assert.throws(() => quote(s, ['football-away'], 0), /stake/i);
 assert.throws(() => quote(s, ['football-away'], 501), /balance/i);
 assert.throws(() => quote(s, ['football-away', 'football-over'], 10), /same.event/i);
 assert.equal(quote(s, ['football-away'], 10).returns, 19);
 assert.ok(events.length >= 8);
});

test('review acceptance debits once and deterministic final settles once', () => {
 const s = initialState(); const q = quote(s, ['football-away'], 10);
 const a = accept(s, q, 'ticket-1'); assert.equal(a.sportsBalance, 490);
 assert.throws(() => accept(a, q, 'ticket-1'), /duplicate/i);
 assert.throws(() => accept(advance(s), q, 'stale'), /changed/i);
 assert.throws(() => settle(a, 'ticket-1'), /final/i);
 const paid = settle(advance(advance(a)), 'ticket-1');
 assert.equal(paid.sportsBalance, 509); assert.equal(paid.tickets[0].status, 'won');
 assert.throws(() => settle(paid, 'ticket-1'), /settled/i);
});

test('all market families settle from declared results including spread pushes', () => {
 for (const [id, status, balance] of [['football-spread-6','void',500], ['football-spread-3.5','won',509.5], ['football-prop-over','won',509], ['basketball-alt-over','lost',490], ['soccer-home','lost',490]] as const) {
  assert.ok(markets.some(m => m.id === id), id);
  const s = initialState(); const a = accept(s, quote(s, [id], 10), id);
  const paid = settle(advance(advance(a)), id);
  assert.equal(paid.tickets[0].status, status); assert.equal(paid.sportsBalance, balance);
 }
 assert.ok(markets.length >= 100);
});

import * as demo from '../app/lib/demo';
test('cashout review expires on scenario change and pays only once', () => {
 const s = initialState(); const a = accept(s, quote(s, ['football-away'], 10), 'c');
 const q = demo.cashoutQuote(a, 'c'); assert.equal(q.amount, 8);
 assert.throws(() => demo.cashoutAccept(advance(a), q), /changed/i);
 const paid = demo.cashoutAccept(a,q); assert.equal(paid.sportsBalance, 498);
 assert.equal(paid.tickets[0].status, 'cashed-out');
 assert.throws(() => demo.cashoutAccept(paid,q), /unavailable/i);
 assert.throws(() => demo.cashoutQuote(advance(advance(a)), 'c'), /unavailable/i);
});

test('persistable limits, pause and ticket edit enforce stakes and re-quote', () => {
 let s = demo.saveSettings(initialState(), {maxStake: 15, sessionBudget: 20, paused: false});
 assert.throws(() => quote(s,['football-away'],16), /limit/i);
 s = accept(s,quote(s,['football-away'],10),'edit');
 assert.throws(() => quote(s,['basketball-away'],11), /budget/i);
 const review = demo.editQuote(s,'edit',['basketball-away'],15);
 const edited = demo.editAccept(s,review);
 assert.equal(edited.sportsBalance,485); assert.equal(edited.tickets[0].stake,15);
 assert.throws(() => demo.editAccept(edited,review), /changed/i);
 assert.throws(() => quote(demo.saveSettings(s,{maxStake:15,sessionBudget:20,paused:true}),['soccer-away'],1), /paused/i);
});
test('free picks never debit either wallet; rewards earned and redeemed once', () => {
 const s = initialState();
 assert.throws(() => demo.enterContest(s,['football-away']), /three/i);
 const entered = demo.enterContest(s,['football-away','basketball-home','soccer-away']);
 assert.equal(entered.sportsBalance,s.sportsBalance); assert.equal(entered.predictionBalance,s.predictionBalance);
 assert.throws(() => demo.enterContest(entered,['football-away','basketball-home','soccer-away']), /entered/i);
 assert.throws(() => demo.settleContest(entered), /final/i);
 const graded = demo.settleContest(advance(advance(entered)));
 assert.equal(graded.contest?.score,2); assert.equal(graded.rewardPoints,200);
 assert.throws(() => demo.settleContest(graded), /graded/i);
 const redeemed = demo.redeemReward(graded); assert.equal(redeemed.rewardPoints,100);
 assert.equal(redeemed.sportsBalance,501); assert.equal(redeemed.rewards.length,2);
});
test('edits cannot bypass a reduced cumulative budget; void legs removed in parlay',()=>{
 let s=initialState();s=accept(s,quote(s,['football-away'],20),'a');
 s=demo.saveSettings(s,{maxStake:100,sessionBudget:10,paused:false});
 assert.throws(()=>demo.editQuote(s,'a',['basketball-away'],5),/budget/i);
 const base=initialState();const paid=settle(advance(advance(accept(base,quote(base,['football-spread-6','basketball-away'],10),'p'))),'p');
 assert.equal(paid.sportsBalance,509);
});
