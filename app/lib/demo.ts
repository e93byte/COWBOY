export const events = [
 { id: 'football', league: 'Football', competition: 'Pro Football', title: 'Buffalo at Miami', final: [27,21], player: 'J. Allen', stat: 'passing yards', playerFinal: 284, line: 47.5, scores: ['17 – 14 · Q3 08:42', '20 – 14 · Q4 05:00', '27 – 21 · Final'], live: true },
 { id: 'basketball', league: 'Basketball', competition: 'Pro Basketball', title: 'Boston at New York', final: [98,94], player: 'J. Tatum', stat: 'points', playerFinal: 31, line: 192.5, scores: ['82 – 79 · Q4 04:18', '90 – 88 · Q4 01:00', '98 – 94 · Final'], live: true },
 { id: 'seattle', league: 'Football', competition: 'Pro Football', title: 'Seattle at Chicago', final: [24,17], player: 'D. Swift', stat: 'rushing yards', playerFinal: 72, line: 41.5, scores: ['Today · 18:30', '14 – 10 · Q3', '24 – 17 · Final'], live: false },
 { id: 'denver', league: 'Basketball', competition: 'Pro Basketball', title: 'Denver at Phoenix', final: [112,108], player: 'N. Jokic', stat: 'rebounds', playerFinal: 14, line: 220.5, scores: ['Today · 19:00', '82 – 80 · Q3', '112 – 108 · Final'], live: false },
 { id: 'hockey', league: 'Hockey', competition: 'Pro Hockey', title: 'Toronto at Montreal', final: [4,2], player: 'A. Matthews', stat: 'shots', playerFinal: 5, line: 5.5, scores: ['1 – 1 · P2 12:40', '3 – 2 · P3', '4 – 2 · Final'], live: true },
 { id: 'soccer', league: 'Soccer', competition: 'Club Showcase', title: 'North London at Manchester', final: [2,1], player: 'A. Cole', stat: 'shots', playerFinal: 3, line: 2.5, scores: ['0 – 0 · 34:00', '1 – 1 · 72:00', '2 – 1 · Final'], live: true },
 { id: 'baseball', league: 'Baseball', competition: 'Pro Baseball', title: 'Los Angeles at San Diego', final: [5,3], player: 'M. Betts', stat: 'hits', playerFinal: 2, line: 8.5, scores: ['Tomorrow · 16:10', '3 – 2 · 7th', '5 – 3 · Final'], live: false },
 { id: 'college', league: 'Football', competition: 'College Showcase', title: 'Oregon at Michigan', final: [31,24], player: 'A. Reed', stat: 'receiving yards', playerFinal: 87, line: 54.5, scores: ['Tomorrow · 12:00', '21 – 17 · Q3', '31 – 24 · Final'], live: false },
];
export type Market = { id: string; event: string; group: string; label: string; decimal: number; metric: 'margin' | 'total' | 'player'; line: number; direction: 1 | -1 };
export const markets: Market[] = events.flatMap(e => {
 const [away, home] = e.title.split(' at ');
 const make = (suffix: string, group: string, label: string, decimal: number, metric: Market['metric'], line: number, direction: 1 | -1): Market => ({id: `${e.id}-${suffix}`, event: e.id, group, label, decimal, metric, line, direction});
 return [
 make('away','Winner',`${away} wins`,1.9,'margin',0,1), make('home','Winner',`${home} wins`,2.1,'margin',0,-1),
 make('over','Total',`Over ${e.line} points`,2,'total',e.line,1), make('under','Total',`Under ${e.line} points`,1.85,'total',e.line,-1),
 ...[3.5,6,7.5].flatMap(line => [make(`spread-${line}`,'Alternate spreads',`${away} −${line}`,1.95,'margin',line,1),make(`home-spread-${line}`,'Alternate spreads',`${home} +${line}`,1.85,'margin',line,-1)]),
 make('alt-over','Alternate totals',`Over ${e.line + 5}`,2.4,'total',e.line+5,1), make('alt-under','Alternate totals',`Under ${e.line + 5}`,1.6,'total',e.line+5,-1),
 make('prop-over','Player props',`${e.player} over ${e.playerFinal - .5} ${e.stat}`,1.9,'player',e.playerFinal-.5,1),make('prop-under','Player props',`${e.player} under ${e.playerFinal - .5} ${e.stat}`,1.9,'player',e.playerFinal-.5,-1),
 ];
});
export function outcome(id: string): 'won' | 'lost' | 'void' {
 const m = markets.find(m => m.id === id); if (!m) throw Error('Unknown selection');
 const e = events.find(e => e.id === m.event)!;
 const value = m.metric === 'margin' ? e.final[0]-e.final[1] : m.metric === 'total' ? e.final[0]+e.final[1] : e.playerFinal;
 const delta = (value-m.line)*m.direction;
 return delta === 0 ? 'void' : delta > 0 ? 'won' : 'lost';
}
export type Ticket = { id: string; picks: string[]; stake: number; returns: number; status: 'open' | 'won' | 'lost' | 'void' | 'cashed-out' };
export type Position = { id: string; side: 'yes' | 'no'; quantity: number; cost: number };
export type Settings = { maxStake: number; sessionBudget: number; paused: boolean };
export type State = { version: 1; sportsBalance: number; predictionBalance: number; scenario: number; tickets: Ticket[]; positions: Position[]; resolved: boolean; history: string[]; settings: Settings; spent: number; rewardPoints: number; rewards: {label: string; points: number}[]; contest: null | {picks: string[]; score: number | null} };
export const round = (n: number) => Math.round(n * 100) / 100;
export function initialState(): State { return { version: 1, sportsBalance: 500, predictionBalance: 200, scenario: 0, tickets: [], positions: [], resolved: false, history: [], settings: {maxStake:500,sessionBudget:1000,paused:false}, spent:0, rewardPoints:0, rewards:[], contest:null }; }
export function quote(s: State, ids: string[], stake: number) {
 if (!ids.length) throw Error('Choose a selection');
 if (!Number.isFinite(stake) || stake <= 0 || round(stake) !== stake) throw Error('Stake must be positive with at most two decimals');
 if (stake > s.sportsBalance) throw Error('Insufficient sportsbook demo balance');
 if (s.settings.paused) throw Error('Demo play paused in account settings');
 if (stake > s.settings.maxStake) throw Error('Per-ticket stake limit exceeded');
 if (s.spent + stake > s.settings.sessionBudget) throw Error('Session stake budget exceeded');
 const picks = ids.map(id => { const p = markets.find(m => m.id === id); if (!p) throw Error('Unknown selection'); return p; });
 if (new Set(picks.map(p => p.event)).size !== picks.length) throw Error('Same-event combinations unsupported: no correlated SGP quote');
 if (s.scenario === 2) throw Error('Markets closed in final scenario');
 return { picks: [...ids], stake, returns: round(stake * picks.reduce((n, p) => n * p.decimal, 1)), scenario: s.scenario };
}

export function buy(s: State, side: 'yes' | 'no', quantity: number, id: string): State {
 if (s.resolved) throw Error('Contract resolved');
 if (!Number.isSafeInteger(quantity) || quantity <= 0) throw Error('Quantity must be a positive whole number');
 if (s.positions.some(p => p.id === id)) throw Error('Duplicate position');
 const cost = round(quantity * (side === 'yes' ? .6 : .45));
 if (cost > s.predictionBalance) throw Error('Insufficient prediction demo balance');
 return { ...s, predictionBalance: round(s.predictionBalance - cost), positions: [...s.positions, { id, side, quantity, cost }], history: [...s.history, `Bought ${quantity} ${side.toUpperCase()} for ${cost.toFixed(2)} demo credits`] };
}
export function sell(s: State, id: string): State {
 const p = s.positions.find(p => p.id === id);
 if (!p || s.resolved) throw Error('Position unavailable');
 const proceeds = round(p.quantity * (p.side === 'yes' ? .55 : .4));
 return { ...s, predictionBalance: round(s.predictionBalance + proceeds), positions: s.positions.filter(p => p.id !== id), history: [...s.history, `Sold ${p.quantity} ${p.side.toUpperCase()} for ${proceeds.toFixed(2)} demo credits`] };
}
export function resolve(s: State): State {
 if (s.resolved) throw Error('Already resolved');
 const payout = s.positions.reduce((n, p) => n + (p.side === 'yes' ? p.quantity : 0), 0);
 return { ...s, resolved: true, positions: [], predictionBalance: round(s.predictionBalance + payout), history: [...s.history, `Controlled resolution: YES; credited ${payout.toFixed(2)} demo credits`] };
}
export function advance(s: State): State { return { ...s, scenario: Math.min(2, s.scenario + 1) }; }
export function accept(s: State, reviewed: ReturnType<typeof quote>, id: string): State {
 if (s.tickets.some(t => t.id === id)) throw Error('Duplicate ticket');
 if (reviewed.scenario !== s.scenario) throw Error('Scenario changed; review again');
 const q = quote(s, reviewed.picks, reviewed.stake);
 return { ...s, spent: round(s.spent + q.stake), sportsBalance: round(s.sportsBalance - q.stake), tickets: [...s.tickets, { id, picks: q.picks, stake: q.stake, returns: q.returns, status: 'open' }] };
}
export function settle(s: State, id: string): State {
 if (s.scenario !== 2) throw Error('Advance to final scenario first');
 const ticket = s.tickets.find(t => t.id === id);
 if (!ticket || ticket.status !== 'open') throw Error('Already settled or unknown ticket');
 const results = ticket.picks.map(outcome);
 const status = results.includes('lost') ? 'lost' : results.every(r => r === 'void') ? 'void' : 'won';
 const payout = status === 'lost' ? 0 : round(ticket.stake * ticket.picks.reduce((n,id) => n * (outcome(id) === 'void' ? 1 : markets.find(m => m.id === id)!.decimal),1));
 return { ...s, sportsBalance: round(s.sportsBalance + payout), tickets: s.tickets.map(t => t.id === id ? { ...t, status } : t) };
}

export type CashoutReview = { id: string; amount: number; scenario: number };
export function cashoutQuote(s: State, id: string): CashoutReview {
 const t = s.tickets.find(t => t.id === id);
 if (!t || t.status !== 'open' || s.scenario === 2) throw Error('Cash-out unavailable');
 return { id, amount: round(t.stake * (s.scenario === 0 ? .8 : 1.1)), scenario: s.scenario };
}
export function cashoutAccept(s: State, review: CashoutReview): State {
 if (s.scenario !== review.scenario) throw Error('Cash-out price changed; review again');
 const fresh = cashoutQuote(s, review.id);
 if (fresh.amount !== review.amount) throw Error('Cash-out price changed');
 return {...s, sportsBalance: round(s.sportsBalance+fresh.amount), tickets: s.tickets.map(t => t.id === review.id ? {...t, status: 'cashed-out'} : t), history: [...s.history, 'Cash-out '+review.id+' credited '+fresh.amount]};
}

export function saveSettings(s: State, settings: Settings): State {
 if (![settings.maxStake,settings.sessionBudget].every(n => Number.isFinite(n) && n >= 0 && round(n) === n)) throw Error('Limits must be positive credits or zero');
 return {...s, settings:{...settings}};
}
export type EditReview = {id:string; previous:string; quote:ReturnType<typeof quote>};
export function editQuote(s:State,id:string,picks:string[],stake:number):EditReview {
 const t=s.tickets.find(t=>t.id===id);
 if(!t || t.status!=='open' || s.scenario!==0) throw Error('Edit unavailable after initial scenario');
 return {id,previous:JSON.stringify(t),quote:quote({...s,sportsBalance:round(s.sportsBalance+t.stake),spent:s.spent-Math.min(stake,t.stake)},picks,stake)};
}
export function editAccept(s:State,r:EditReview):State {
 const t=s.tickets.find(t=>t.id===r.id);
 if(JSON.stringify(t)!==r.previous || r.quote.scenario!==s.scenario) throw Error('Ticket changed; re-quote');
 const q=editQuote(s,r.id,r.quote.picks,r.quote.stake).quote;
 return {...s,sportsBalance:round(s.sportsBalance+t!.stake-q.stake),spent:round(s.spent+Math.max(0,q.stake-t!.stake)),tickets:s.tickets.map(t=>t.id===r.id?{...t,picks:q.picks,stake:q.stake,returns:q.returns}:t),history:[...s.history,'Edited '+r.id]};
}
export function enterContest(s:State,picks:string[]):State {
 if(s.contest) throw Error('Already entered this contest');
 if(s.scenario!==0) throw Error('Contest entry closed');
 const allowed=['football','basketball','soccer'];
 if(picks.length!==3 || !allowed.every(id=>picks.some(p=>p===id+'-away'||p===id+'-home'))) throw Error('Choose three winners, one per contest game');
 return {...s,contest:{picks:[...picks],score:null}};
}
export function settleContest(s:State):State {
 if(!s.contest || s.contest.score!==null) throw Error('Contest unavailable or already graded');
 if(s.scenario!==2) throw Error('Advance to final scenario');
 const score=s.contest.picks.filter(p=>outcome(p)==='won').length;
 return {...s,contest:{...s.contest,score},rewardPoints:s.rewardPoints+score*100,rewards:[...s.rewards,{label:'Daily Three: '+score+'/3 correct',points:score*100}]};
}
export function redeemReward(s:State):State {
 if(s.rewardPoints<100) throw Error('At least 100 points required');
 return {...s,rewardPoints:s.rewardPoints-100,sportsBalance:round(s.sportsBalance+1),rewards:[...s.rewards,{label:'Redeemed for 1 sportsbook demo credit',points:-100}]};
}
