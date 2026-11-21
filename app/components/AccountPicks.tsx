'use client';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LiveEvent } from './LiveWorkspace';
import {ActionIcon, CloseIcon, SportIcon, TabIcon} from './SportIcon';

export type User = {id:string;username:string;email?:string|null;emailVerified?:boolean;leaderboardOptIn?:boolean;tokens?:number;referralCode?:string};
import type { RealPickTicket as Ticket } from '../lib/pick-service';
import { pickName, pickSides, postedPickLine, supportsDrawPick, type PickMarket, type PickSide } from '../lib/pick-outcomes';
import { ScheduleTimeZone } from './ScheduleTimeZone';
import { scheduleDay, scheduleTime } from '../lib/schedule-time';
import { LIVE_LEAGUES } from '../lib/sports-leagues';
import { matchesSearchText } from './BoardSearch';
export type { RealPickTicket as Ticket } from '../lib/pick-service';
export type Selection = {
  event: Pick<LiveEvent, 'id' | 'league' | 'leagueName' | 'name' | 'startsAt'> & {
    sport?: LiveEvent['sport'];
    home: Pick<LiveEvent['home'], 'name' | 'shortName'>;
    away: Pick<LiveEvent['away'], 'name' | 'shortName'>;
  };
  side: PickSide;
  market?: PickMarket;
  requestId: string;
  line?: number | null;
  prop?: { player: string; stat: string; line: number };
};
function canPick(event: LiveEvent, now: number) {
  return event.status === 'scheduled' && Date.parse(event.startsAt) > now;
}
export const CLIENT_API_TIMEOUT_MS = 12_000;

/**
 * All authenticated/detail requests share one bounded lifecycle. A stalled
 * account or Game Center request must never leave a premium surface spinning
 * forever, while a caller-provided signal still wins during unmount/navigation.
 */
export async function api<T>(url:string, options?:RequestInit, timeoutMs = CLIENT_API_TIMEOUT_MS):Promise<T> {
  const controller = new AbortController();
  const parentSignal = options?.signal;
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, {once:true});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res=await fetch(url,{cache:'no-store',...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options?.headers}});
    const data=await res.json();
    if(!res.ok)throw new Error(data.message||'The request could not be completed. Try again.');
    return data;
  } catch (error) {
    if (timedOut) throw new Error('This data request timed out. Showing the last available information; try again shortly.');
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
export function Modal({title,onClose,children,locked=false,className}:{title:string;onClose:()=>void;children:ReactNode;locked?:boolean;className?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const focus=document.activeElement as HTMLElement;dialog?.showModal();return()=>{dialog?.close();focus?.focus();};},[]);
  return <dialog ref={ref} className={className ? `cw-dialog ${className}` : 'cw-dialog'} aria-label={title} onCancel={e=>{e.preventDefault();if(!locked)onClose();}}><div className="cw-dialog-head"><h2>{title}</h2><button aria-label={`Close ${title}`} disabled={locked} onClick={onClose}><CloseIcon/></button></div>{children}</dialog>;
}
export function useAccount(){
  const [user,setCurrentUser]=useState<User|null>(null);
  const [accountLoading,setAccountLoading]=useState(true);
  const [tickets,setTickets]=useState<Ticket[]>([]);
  const [ticketsError,setTicketsError]=useState('');
  const [ticketsBusy,setTicketsBusy]=useState(false);
  const [accountError,setAccountError]=useState('');
  const sessionRequest=useRef<AbortController|null>(null);
  const ticketRequest=useRef<AbortController|null>(null);

  useEffect(() => {
    const verify = async () => {
      if (sessionRequest.current) return;
      const controller = new AbortController();
      sessionRequest.current = controller;
      try {
        const response = await api<{user:User|null}>('/api/account',{signal:controller.signal});
        if (!controller.signal.aborted) {
          setCurrentUser(previous=>previous?.id===response.user?.id && previous?.username===response.user?.username
            ? previous : response.user);
          setAccountError('');
        }
      } catch {
        if (!controller.signal.aborted) setAccountError('Could not check your session. Please try signing in.');
      } finally {
        if (sessionRequest.current===controller) {
          sessionRequest.current=null;
          setAccountLoading(false);
        }
      }
    };
    const visible=()=>{ if (!document.hidden) void verify(); };
    void verify();
    window.addEventListener('focus',visible);
    document.addEventListener('visibilitychange',visible);
    return ()=>{
      sessionRequest.current?.abort();
      sessionRequest.current=null;
      window.removeEventListener('focus',visible);
      document.removeEventListener('visibilitychange',visible);
    };
  },[]);
  const userId=user?.id;
  const loadTickets=useCallback(async(refresh=false)=>{
    if (!userId) return;
    ticketRequest.current?.abort();
    const controller = new AbortController();
    ticketRequest.current=controller;
    setTicketsBusy(true);
    setTicketsError('');
    try {
      const result=await api<{tickets:Ticket[]}>(refresh?'/api/picks/refresh':'/api/picks',{
        signal:controller.signal,...(refresh?{method:'POST',body:'{}'}:{}),
      });
      if (!controller.signal.aborted) setTickets(result.tickets);
    } catch(error) {
      if (!controller.signal.aborted) setTicketsError((error as Error).message);
    } finally {
      if (ticketRequest.current===controller) {
        ticketRequest.current=null;
        setTicketsBusy(false);
      }
    }
  },[userId]);
  useEffect(()=>{
    setTickets([]);
    setTicketsError('');
    setTicketsBusy(false);
    void loadTickets();
    return ()=>{
      ticketRequest.current?.abort();
      ticketRequest.current=null;
    };
  },[loadTickets]);
  function setUser(next: User|null) {
    sessionRequest.current?.abort();
    sessionRequest.current=null;
    ticketRequest.current?.abort();
    ticketRequest.current=null;
    setTickets([]);
    setTicketsBusy(false);
    setTicketsError('');
    setAccountLoading(false);
    setAccountError('');
    setCurrentUser(next);
  }
  const updateTicket = (updated: Ticket) => {
    setTickets(previous => previous.map(ticket => ticket.id === updated.id ? updated : ticket));
  };
  return {user,setUser,accountLoading,accountError,tickets,ticketsError,ticketsBusy,loadTickets,updateTicket};
}
export function AccountDialog({user,onUser,onClose}:{user:User|null;onUser:(u:User|null)=>void;onClose:()=>void}){
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [deleting,setDeleting] = useState(false);
  const [deletePassword,setDeletePassword] = useState('');
  const [accountAction,setAccountAction] = useState<'export'|'revoke'|'delete'|'email'|null>(null);
  const [emailInput,setEmailInput] = useState('');
  const [notice,setNotice] = useState('');
  async function manageAccount(action: 'export'|'revoke'|'delete') {
    if (accountAction || pending) return;
    setAccountAction(action);
    setError('');
    setNotice('');
    try {
      if (action === 'export') {
        const data = await api<unknown>('/api/account/export');
        const href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'], {type:'application/json'}));
        const download = document.createElement('a');
        download.href = href;
        download.download = 'cowboy-account.json';
        download.click();
        setTimeout(()=>URL.revokeObjectURL(href),1000);
        setNotice('Account export ready.');
      } else if (action === 'delete') {
        await api('/api/account/delete',{method:'DELETE',body:JSON.stringify({password:deletePassword})});
        setDeletePassword('');
        setDeleting(false);
        onUser(null);
        onClose();
      } else {
        const result = await api<{revoked:number}>('/api/account/sessions',{method:'POST',body:'{}'});
        setNotice(result.revoked ? `Signed out ${result.revoked} other ${result.revoked===1?'session':'sessions'}.` : 'No other sessions are active.');
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setAccountAction(null);
    }
  }
  async function manageAccountEmail() {
    if (accountAction || pending || !emailInput.trim()) return;
    setAccountAction('email');
    setError('');
    setNotice('');
    try {
      const result = await api<{email:string;emailSent:boolean}>('/api/account/email',{method:'POST',body:JSON.stringify({email:emailInput.trim()})});
      setEmailInput('');
      if (user) onUser({...user,email:result.email,emailVerified:false});
      setNotice(result.emailSent?'Verification email sent. Check your inbox to confirm the address.':'Email saved, but the verification email could not be sent right now. You can request a new one later.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setAccountAction(null);
    }
  }
  const submit=async()=>{setPending(true);setError('');try{if(user){await api('/api/account',{method:'DELETE'});onUser(null);}else{const r=await api<{user:User}>('/api/account',{method:'POST',body:JSON.stringify({action:mode,username,password})});onUser(r.user);}onClose();}catch(e){setError((e as Error).message);}finally{setPending(false);}};
  return <Modal title={user ? deleting?'Delete account':'Your account' : 'Welcome to COWBOY'} onClose={onClose} locked={pending||!!accountAction}>{user ? deleting ? <>
    <p className="cw-dialog-copy">This permanently removes your COWBOY account, follows, and saved free picks from the active app store and ends all sessions.</p>
    <form onSubmit={event=>{event.preventDefault();void manageAccount('delete');}}>
      <label>Current password <input autoFocus type="password" autoComplete="current-password" required minLength={10} maxLength={128}
        value={deletePassword} disabled={!!accountAction} onChange={event=>setDeletePassword(event.target.value)}/></label>
      {error&&<p role="alert" className="cw-form-error">{error}</p>}
      <button className="cw-delete-account" type="submit" disabled={!!accountAction}>
        {accountAction==='delete'?'Deleting account…':'Permanently delete account'}
      </button>
      <button type="button" disabled={!!accountAction} onClick={()=>{setDeleting(false);setDeletePassword('');setError('');}}>Keep account</button>
    </form>
  </> : <>
    <p className="cw-dialog-copy">Signed in as <strong>{user.username}</strong>. Your picks and follows are saved to this account.</p>
    <form className="cw-email-form" onSubmit={event=>{event.preventDefault();void manageAccountEmail();}}>
      <label>Recovery email<input type="email" name="email" autoComplete="email" maxLength={254}
        placeholder={user.email ?? 'Enter your email address'} disabled={!!accountAction} onChange={event=>setEmailInput(event.target.value)}/></label>
      <button type="submit" disabled={!!accountAction||!emailInput.trim()}>
        {accountAction==='email'?'Sending verification…':user.email?'Update email':'Add recovery email'}
      </button>
      {user.email && <span className="cw-field-hint">{user.emailVerified?'Verified':'Verification pending — check your inbox.'}</span>}
    </form>
    <div className="cw-account-actions">
      <button disabled={pending||!!accountAction} onClick={()=>void manageAccount('export')}>
        {accountAction==='export'?'Preparing download…':'Download my data'}
      </button>
      <button disabled={pending||!!accountAction} onClick={()=>void manageAccount('revoke')}>
        {accountAction==='revoke'?'Signing out other sessions…':'Sign out other sessions'}
      </button>
    </div>
    {notice && <p role="status" className="cw-field-hint">{notice}</p>}
    {error && <p role="alert" className="cw-form-error">{error}</p>}
    <button className="cw-primary" disabled={pending||!!accountAction} onClick={submit}>{pending?'Signing out…':'Sign out'}</button>
    <button className="cw-delete-account" disabled={pending||!!accountAction}
      onClick={()=>{setDeletePassword('');setError('');setNotice('');setDeleting(true);}}>Delete account</button>
  </>:<><div className="cw-auth-tabs"><button aria-pressed={mode==='login'} onClick={()=>{setMode('login');setError('');}} disabled={pending}><ActionIcon action="account"/>Sign in</button><button aria-pressed={mode==='register'} onClick={()=>{setMode('register');setError('');}} disabled={pending}><ActionIcon action="account"/>Create account</button></div><form onSubmit={e=>{e.preventDefault();void submit();}}><label>Username<input autoFocus name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_-]+" value={username} disabled={pending} onChange={e=>setUsername(e.target.value)}/></label><span className="cw-field-hint">3–30 letters, numbers, underscores or hyphens.</span><label>Password<input type="password" name="password" autoComplete={mode==='register'?'new-password':'current-password'} required minLength={10} value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}/></label><span className="cw-field-hint">At least 10 characters. Use a unique password for this local prototype.</span>{!user&&mode==='login'&&<p className="cw-field-hint"><a href="/forgot-password">Forgot password?</a></p>}{error&&<p role="alert" className="cw-form-error">{error}</p>}<button className="cw-primary" disabled={pending} type="submit">{pending?'Please wait…':mode==='register'?'Create free account':'Sign in to COWBOY'}</button></form><p className="cw-dialog-footnote">Local-server account, not a production identity service. Do not use a password you use elsewhere. No payments or money are involved.</p></>}</Modal>;
}
function EditPickDialog({ticket,event,onSave,onClose}: {
  ticket: Ticket; event: LiveEvent; onSave: (ticket: Ticket) => void; onClose: () => void;
}) {
  const [side,setSide] = useState<PickSide|null>(null);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const market = ticket.market ?? 'moneyline';
  const submit = async () => {
    if (!side || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await api<{ticket: Ticket}>('/api/picks', {
        method: 'PATCH',
        body: JSON.stringify({id: ticket.id, side, revision: ticket.changes?.length ?? 0}),
      });
      onSave(result.ticket);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  };
  return <Modal title="Edit free pick" onClose={onClose} locked={pending}>
    <p className="cw-dialog-copy">{ticket.eventName}</p>
    <p className="cw-dialog-copy">Current pick: <strong>{ticket.selection}</strong>. Changes close when the game starts.</p>
    <div role="group" aria-label="Choose a new outcome" className={`cw-pick-options ${pickSides(event.league,market).length === 3 ? 'cw-three-outcomes' : ''}`}>
      {pickSides(event.league,market).map(choice => (
        <button key={choice} aria-pressed={side===choice} disabled={choice===ticket.side || pending}
          onClick={() => {setSide(choice);setError('');}}>{pickName(event,choice,'name',market,ticket.line)}</button>
      ))}
    </div>
    {error && <p role="alert" className="cw-form-error">{error}</p>}
    <button className="cw-primary" disabled={!side || pending} onClick={()=>void submit()}>
      {pending ? 'Saving…' : 'Save change'}
    </button>
  </Modal>;
}
const historySorts = [
  {id:'entered-new',label:'Entry date (newest)',field:'createdAt',direction:-1},
  {id:'entered-old',label:'Entry date (oldest)',field:'createdAt',direction:1},
  {id:'game-new',label:'Event date (newest)',field:'startsAt',direction:-1},
  {id:'game-old',label:'Event date (oldest)',field:'startsAt',direction:1},
  {id:'result-new',label:'Result date (newest)',field:'settledAt',direction:-1},
] as const;

const historyFilters = ['all', 'open', 'live', 'settled', 'won', 'lost', 'void', 'cancelled'] as const;

type TicketGroup = {key:string; tickets:Ticket[]};
function groupTickets(tickets: Ticket[]): TicketGroup[] {
  const groups = new Map<string, TicketGroup>();
  for (const ticket of tickets) {
    const key = ticket.entryId ?? ticket.id;
    const group = groups.get(key);
    if (group) group.tickets.push(ticket);
    else groups.set(key, {key, tickets:[ticket]});
  }
  return [...groups.values()];
}
function groupStatus(tickets: Ticket[]) {
  const statuses = new Set(tickets.map(ticket=>ticket.status));
  if (statuses.size === 1) return tickets[0].status;
  if (statuses.has('open')) return 'open';
  if (statuses.has('won') && statuses.has('lost')) return 'mixed';
  if (statuses.has('won')) return 'won';
  if (statuses.has('lost')) return 'lost';
  if (statuses.has('void')) return 'void';
  return 'cancelled';
}
function groupStatusLabel(status: ReturnType<typeof groupStatus>, tickets: Ticket[]) {
  if (status === 'mixed') return `${tickets.filter(ticket=>ticket.status==='won').length} won · ${tickets.filter(ticket=>ticket.status==='lost').length} lost`;
  return status[0].toUpperCase()+status.slice(1);
}

export function PicksHistory({tickets,busy,error,onRefresh,onUpdate,user,onSignIn,events,onGame,onRebet,onBrowse,feedCurrent}:{tickets:Ticket[];busy:boolean;error:string;onRefresh:()=>void;onUpdate:(ticket: Ticket)=>void;user:User|null;onSignIn:()=>void;events:LiveEvent[];onGame:(ticket:Ticket,event?:LiveEvent)=>void;onRebet:(ticket:Ticket,event:LiveEvent)=>void;onBrowse:()=>void;feedCurrent:boolean}){
  const zone = useContext(ScheduleTimeZone);
  const [cancelling,setCancelling]=useState<Ticket|null>(null);
  const [cancelPending,setCancelPending]=useState(false);
  const [cancelError,setCancelError]=useState('');
  const [editing,setEditing]=useState<{ticket:Ticket;event:LiveEvent}|null>(null);
  const [sharedId,setSharedId]=useState('');
  const sharePick=async(ticket:Ticket)=>{
    const result=ticket.status==='won'?'won':'lost';
    const text=`COWBOY free pick: ${ticket.selection} in ${ticket.eventName} — ${result}. Free picks only, no money. betcowboy.vercel.app`;
    try{
      if(navigator.share){await navigator.share({title:'My COWBOY pick',text});}
      else{await navigator.clipboard.writeText(text);}
      setSharedId(ticket.id);
      setTimeout(()=>setSharedId(current=>current===ticket.id?'':current),2000);
    }catch{/* user dismissed the share sheet */}
  };
  const [filter,setFilter]=useState<(typeof historyFilters)[number]>('all');
  const [search,setSearch]=useState('');
  const [league,setLeague]=useState('');
  const [entryWindow,setEntryWindow]=useState('0');
  const [from,setFrom]=useState('');
  const [through,setThrough]=useState('');
  const [sort,setSort]=useState<(typeof historySorts)[number]>(historySorts[0]);
  const eventByKey = new Map(events.map(event => [event.league + ':' + event.id, event]));
  const matchup = (ticket: Ticket) => eventByKey.get(ticket.league + ':' + ticket.eventId);
  const livePick = (ticket: Ticket) => feedCurrent && ticket.status === 'open' && matchup(ticket)?.status === 'live';
  const leagues = new Map(tickets.map(ticket=>[
    ticket.league, LIVE_LEAGUES.find(item=>item.id===ticket.league)?.name ?? ticket.league.toUpperCase(),
  ]));
  const searchActive = !!search.trim() || !!league || entryWindow !== '0';
  const custom = entryWindow === 'custom';
  const invalidRange = custom && !!from && !!through && from > through;
  const days = Number(entryWindow) || 0;
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : -Infinity;
  const matching = tickets.filter(ticket=>{
    if (invalidRange || (league && league !== ticket.league)) return false;
    if (days && !(Date.parse(ticket.createdAt) >= cutoff)) return false;
    if (custom && (from || through)) {
      const date = scheduleDay(ticket.createdAt,zone);
      if (!date || (from && date < from) || (through && date > through)) return false;
    }
    return matchesSearchText(search,[ticket.eventName,ticket.selection,ticket.league,leagues.get(ticket.league)].join(' '));
  });
  const counts = { all: matching.length, open: 0, live: 0, settled: 0, won: 0, lost: 0, void: 0, cancelled: 0 };
  for (const ticket of matching) {
    counts[ticket.status]++;
    if (ticket.status !== 'open') counts.settled++;
    if (livePick(ticket)) counts.live++;
  }
  const decided = counts.won + counts.lost;
  const accuracy = decided ? new Intl.NumberFormat(undefined,{style:'percent',maximumFractionDigits:1}).format(counts.won / decided) : null;
  const results = matching.filter(ticket=>(ticket.status==='won' || ticket.status==='lost') && Number.isFinite(Date.parse(ticket.startsAt)))
    .sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt) ||
      Date.parse(b.createdAt)-Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const latest = results[0];
  const streakEnd = latest ? results.findIndex(ticket=>ticket.status!==latest.status) : 0;
  const streak = streakEnd === -1 ? results.length : streakEnd;
  const outcome = latest?.status==='won' ? (streak===1?'win':'wins') : (streak===1?'loss':'losses');
  const filteredTickets = matching.filter(ticket => {
    if (filter === 'live') return livePick(ticket);
    if (filter === 'settled') return ticket.status !== 'open';
    return filter === 'all' || ticket.status === filter;
  }).sort((a,b)=>{
    const left = Date.parse(a[sort.field] ?? '');
    const right = Date.parse(b[sort.field] ?? '');
    if (Number.isNaN(left) || Number.isNaN(right)) return Number(Number.isNaN(left)) - Number(Number.isNaN(right));
    return sort.direction * (left - right);
  });
  const groupedTickets = groupTickets(filteredTickets);
  const cancel=async()=>{
    if(!cancelling||cancelPending)return;
    setCancelPending(true);setCancelError('');
    try{
      const result=await api<{ticket:Ticket}>(`/api/picks?id=${encodeURIComponent(cancelling.id)}`,{method:'DELETE'});
      onUpdate(result.ticket);
      setCancelling(null);
    }catch(e){setCancelError((e as Error).message);}finally{setCancelPending(false);}
  };
  return <section className="cw-history">
    {user && <div className="cw-history-head">
      <div><h2>Pick tracker</h2><p>Follow open picks and check confirmed results.</p></div>
      <button disabled={busy} onClick={onRefresh}>{busy?'Checking results…':'Refresh results'}</button>
    </div>}
    {user && tickets.length > 0 && <div className="cw-history-search">
      <label>Search picks<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Matchup or selection"/></label>
      <div><label htmlFor="cw-history-league">Pick league</label><select id="cw-history-league" value={league} onChange={event=>setLeague(event.target.value)}>
        <option value="">All leagues</option>
        {[...leagues].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></div>
      <div><label htmlFor="cw-history-date">When entered</label><select id="cw-history-date" value={entryWindow} onChange={event=>setEntryWindow(event.target.value)}>
        <option value={0}>All time</option>
        {[7,30,90].map(day=><option key={day} value={day}>Last {day} days</option>)}
        <option value="custom">Custom dates</option>
      </select></div>
      <div><label htmlFor="cw-history-sort">Sort picks</label><select id="cw-history-sort" value={sort.id} onChange={event=>{
        const picked = historySorts.find(option=>option.id===event.target.value);
        if (picked) setSort(picked);
      }}>
        {historySorts.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
      </select></div>
      {custom && <fieldset className="cw-history-range">
        <legend>Entry dates</legend>
        <label>From<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label>
        <label>Through<input type="date" value={through} onChange={event=>setThrough(event.target.value)}/></label>
        {invalidRange && <p className="cw-form-error" role="alert">The start date must be on or before the end date.</p>}
      </fieldset>}
      {searchActive && <button onClick={()=>{setSearch('');setLeague('');setEntryWindow('0');setFrom('');setThrough('');}}>Clear search filters</button>}
    </div>}
    {user && matching.length > 0 && <section className="cw-history-record" aria-labelledby="cw-history-record">
      <h3 id="cw-history-record">{searchActive ? 'Filtered pick record' : 'Pick record'}</h3>
      <dl>
        <div><dt>Wins</dt><dd>{counts.won}</dd></div>
        <div><dt>Losses</dt><dd>{counts.lost}</dd></div>
        <div><dt>Accuracy</dt><dd>{accuracy ?? 'Pending'}</dd></div>
      </dl>
      <p>{decided ? `Based on ${decided} confirmed ${decided === 1 ? 'result' : 'results'}.` : 'Accuracy appears after your first confirmed win or loss.'}</p>
      {latest && <div className="cw-record-form">
        <div className="cw-record-form-heading"><h4>Recent results</h4>
          <strong>{streak} {outcome} in a row</strong>
        </div>
        <ol role="list" aria-label="Recent results, newest game first">
          {results.slice(0,5).map(ticket=><li key={ticket.id}>
            <button type="button" className={ticket.status}
              aria-label={`${ticket.eventName} · ${ticket.status==='won'?'Won':'Lost'}`}
              onClick={()=>onGame(ticket,matchup(ticket))}>{ticket.status==='won'?'W':'L'}</button>
          </li>)}
        </ol>
      </div>}
    </section>}
    {user && tickets.length > 0 && <div role="group" aria-label="Pick history filters" className="cw-history-tabs">
      {historyFilters.map(value => (
        <button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>
          <TabIcon tab={value}/>{value[0].toUpperCase()+value.slice(1)} ({counts[value]})
        </button>
      ))}
    </div>}
    {error && <p className="cw-alert" role="alert">{error}</p>}
    {!user ? <div className="cw-empty"><h3>Sign in to see your picks</h3><p>Track the games you picked and see the results here.</p><button onClick={onSignIn}>Sign in</button></div>
      : busy && !tickets.length ? <div className="cw-empty" role="status">Loading your picks…</div>
      : !tickets.length ? <div className="cw-empty"><h3>No picks yet</h3><p>Choose a winner in an upcoming game to get started.</p><button onClick={onBrowse}>Browse games</button></div>
      : <div className="cw-ticket-list">
        {filteredTickets.length===0 && <div className="cw-empty" role="status">
          <h3>{filter==='live'&&!feedCurrent?'Live pick updates unavailable':searchActive?'No picks match these filters.':`No ${filter} picks yet.`}</h3>
        </div>}
        {groupedTickets.map(group => {
          const status = groupStatus(group.tickets);
          const multiLeg = group.tickets.length > 1;
          const firstTicket = group.tickets[0];
          const firstEvent = matchup(firstTicket);
          const firstMarket = firstTicket.market ?? 'moneyline';
          const singlePickLabel = firstMarket === 'spread' ? 'Free spread pick'
            : firstMarket === 'total' ? 'Free total pick'
            : firstTicket.side === 'draw' ? 'Free draw pick' : 'Free winner pick';
          return <article className={`cw-ticket cw-tracker-card ${multiLeg ? 'cw-entry-card' : ''}`} key={group.key}>
            <header>
              <span><SportIcon sport={firstEvent?.sport ?? 'all'}/>{multiLeg ? `Free-picks entry · ${group.tickets.length} legs` : (firstEvent?.leagueName || firstTicket.league.toUpperCase()) + ' · ' + singlePickLabel}</span>
              <span className={`cw-ticket-status ${status}`}>{groupStatusLabel(status,group.tickets)}</span>
            </header>
            {multiLeg && <p className="cw-entry-summary">Each leg settles independently. This entry’s result updates as source-confirmed results arrive.</p>}
            <div className="cw-entry-legs">
            {group.tickets.map((ticket, legIndex) => {
              const event = matchup(ticket);
              const beforeStart = ticket.status === 'open' && Date.parse(ticket.startsAt) > Date.now();
              const displayField = sort.field;
              const displayDate = ticket[displayField];
              const resultLabel = ticket.status === 'cancelled' ? 'Cancelled' : 'Confirmed';
              const dateLabel = displayField === 'startsAt' ? 'Event' : displayField === 'createdAt'
                ? 'Entered' : resultLabel;
              return <div className={`cw-entry-leg ${multiLeg ? 'cw-entry-leg-bordered' : ''}`} key={ticket.id}>
                {multiLeg && <div className="cw-entry-leg-label">Leg {(ticket.entryIndex ?? legIndex) + 1} of {ticket.entrySize ?? group.tickets.length}</div>}
                <div className="cw-tracker-matchup">
                  <h3>{ticket.eventName}</h3>
                  {feedCurrent&&event?.status==='live'&&<p className="cw-live-label">
                    {event.statusText}{event.away.score!==null&&event.home.score!==null&&` · ${event.away.shortName} ${event.away.score}–${event.home.score} ${event.home.shortName}`}
                  </p>}
                  <p>Your pick: <strong>{ticket.selection}</strong></p>
                  {!!ticket.changes?.length && <details className="cw-pick-changes">
                    <summary>Change history ({ticket.changes.length})</summary>
                    <ol>{ticket.changes.map((change,index) => (
                      <li key={index}>Previously {change.selection} · <time dateTime={change.changedAt}>{new Date(change.changedAt).toLocaleString()}</time></li>
                    ))}</ol>
                  </details>}
                </div>
                <footer>
                  <small className="cw-history-times">
                    <span>{displayDate && Number.isFinite(Date.parse(displayDate)) ? <>{dateLabel} <time dateTime={displayDate}>{scheduleTime(displayDate,zone)}</time></> : 'Date unavailable'}</span>
                    {displayField!=='settledAt' && ticket.settledAt && <span>{resultLabel} <time dateTime={ticket.settledAt}>{scheduleTime(ticket.settledAt,zone)}</time></span>}
                  </small>
                  <div className="cw-tracker-actions">
                    <button onClick={()=>onGame(ticket,event)}>Game center</button>
                    {event && (ticket.status==='won' || ticket.status==='lost' || ticket.status==='cancelled' || ticket.status==='void') && canPick(event, Date.now()) &&
                      <button onClick={()=>onRebet(ticket,event)}>Pick again</button>}
                    {(ticket.status==='won' || ticket.status==='lost') &&
                      <button onClick={()=>void sharePick(ticket)}>{sharedId===ticket.id?'Copied':'Share'}</button>}
                    {beforeStart && feedCurrent && event?.status === 'scheduled' && Date.parse(event.startsAt) > Date.now() &&
                      <button disabled={busy} onClick={()=>setEditing({ticket,event})}>Edit pick</button>}
                    {beforeStart && <button className="cw-clear" aria-label={`Cancel pick: ${ticket.selection}`} disabled={busy} onClick={()=>{setCancelError('');setCancelling(ticket);}}>Cancel pick</button>}
                  </div>
                </footer>
              </div>;
            })}
            </div>
          </article>;
        })}
      </div>}
    {editing && <EditPickDialog {...editing} onClose={()=>setEditing(null)}
      onSave={ticket=>{onUpdate(ticket);setEditing(null);}}/>}
    {cancelling&&<Modal title="Cancel your free pick?" onClose={()=>setCancelling(null)} locked={cancelPending}><p className="cw-dialog-copy">Remove your call for <strong>{cancelling.selection}</strong> in {cancelling.eventName}? The server will verify the game has not started before cancelling.</p>{cancelError&&<p role="alert" className="cw-form-error">{cancelError}</p>}<button className="cw-primary" disabled={cancelPending} onClick={()=>void cancel()}>{cancelPending?'Cancelling…':'Confirm cancellation'}</button><button className="cw-clear" disabled={cancelPending} onClick={()=>setCancelling(null)}>Keep pick</button></Modal>}
  </section>;
}
export function PickPanel({selections,user,disabled,pending,draftEvents,onChoose,onChangeMarket,onClear,onReview,onRemove,onSignIn}: {
  selections: Selection[]; user: User|null; disabled: boolean; pending: boolean;
  draftEvents: ReadonlyMap<string, LiveEvent>;
  onChoose: (event: LiveEvent, side: PickSide, market?: PickMarket) => void;
  onChangeMarket: (selection: Selection, event: LiveEvent, side: PickSide, market: PickMarket) => void;
  onClear: () => void;
  onReview: () => void; onRemove: (selection: Selection) => void; onSignIn: () => void;
}) {
  const zone = useContext(ScheduleTimeZone);
  const [confirmClear,setConfirmClear] = useState(false);
  const count = selections.length;
  return <div className="cw-slip">
    <div className="cw-slip-heading"><h2>{count > 1 ? `Your picks (${count})` : 'Your pick'}</h2><span>FREE ENTRY</span></div>
    {count ? <div className="cw-selected">
      {selections.map(selection => {
        const {event,side} = selection;
        const market = selection.market ?? 'moneyline';
        const key = `${event.league}:${event.id}`;
        const current = draftEvents.get(key);
        const marketPosted = (option: PickMarket) =>
          option === 'moneyline' || postedPickLine(current?.odds, side, option) !== null;
        return <div className="cw-draft-pick" key={`${key}:${market}`}>
          <span className="cw-kicker"><SportIcon sport={event.sport ?? 'all'}/>{event.leagueName} · {market==='moneyline'?(supportsDrawPick(event.league)?'FULL-TIME RESULT':'MATCH WINNER'):market==='spread'?'SPREAD':'TOTAL'}</span>
          <h3>{event.name}</h3>
          <div className="cw-market-tabs" role="group" aria-label={`Market for ${event.name}`}>
            {(['moneyline','spread','total'] as const).map(option => (
              <button type="button" key={option} aria-pressed={market===option}
                disabled={pending || !current || !marketPosted(option) || selections.some(item => item.requestId !== selection.requestId &&
                  item.event.league === event.league && item.event.id === event.id && (item.market ?? 'moneyline') === option)}
                onClick={()=>{if (current && market!==option) onChangeMarket(selection,current,pickSides(event.league, option)[0],option);}}>
                {option==='moneyline'?'Winner':option==='spread'?'Spread':'Total'}
              </button>
            ))}
          </div>
          <div className="cw-draft-options" role="group" aria-label={`Selection for ${event.name}`}>
            {pickSides(event.league, market).map(option => (
              <button type="button" key={option} aria-pressed={side===option} disabled={pending || !current}
                onClick={()=>{if (current && (side!==option || market!=='moneyline')) onChoose(current,option,market);}}>
                {pickName(event,option,'name',market,postedPickLine(current?.odds,option,market))}
              </button>
            ))}
          </div>
          <p><time dateTime={event.startsAt}>{scheduleTime(event.startsAt,zone)}</time></p>
          <button className="cw-clear" disabled={pending} aria-label={`Remove selection for ${event.name}`}
            onClick={()=>{setConfirmClear(false);onRemove(selection);}}>Remove selection</button>
        </div>;
      })}
      {count > 1 && <div className="cw-draft-clear">
        {confirmClear && <p role="status">Clear all {count} draft picks?</p>}
        <button type="button" className="cw-clear" disabled={pending} onClick={()=>setConfirmClear(value=>!value)}>
          {confirmClear?'Keep drafts':'Clear draft picks'}
        </button>
        {confirmClear && <button type="button" className="cw-clear" disabled={pending}
          onClick={()=>{setConfirmClear(false);onClear();}}>Clear all</button>}
      </div>}
      {disabled && <p className="cw-form-error" role="status">A pick is paused or locked. Refresh the board or remove the unavailable pick.</p>}
      <button className="cw-primary" disabled={disabled||pending} onClick={user?onReview:onSignIn}>
        {user ? count === 1 ? 'Review free pick' : `Review ${count} free picks` : count === 1 ? 'Sign in to save pick' : 'Sign in to save picks'}
      </button>
    </div> : <div className="cw-slip-empty"><img src="/cowboy-mark.webp" alt=""/><h3>What’s your prediction?</h3>
      <p>Choose an outcome for an upcoming game.<br/>Free picks only. No money on the line.</p></div>}
    <div className="cw-slip-note">Pre-game picks only. Add up to five picks; separate markets on one game count separately.</div>
  </div>;
}
