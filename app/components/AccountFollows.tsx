'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {followKey, isFollowPreference, type FollowPreference} from '../lib/follow-preferences';
import type {LiveEvent} from '../lib/live-sports';
import {api} from './AccountPicks';
import type {Follow} from './BoardSearch';

type Guest = { watched: string[]; follows: Follow[] };
const watchStorage = 'cowboy.watchlist.v1';
const followStorage = 'cowboy.follows.v1';

export function useAccountFollows(userId: string | undefined, accountLoading: boolean) {
  const [guest, setGuest] = useState<Guest>({watched:[],follows:[]});
  const [guestReady, setGuestReady] = useState(false);
  const [profile, setProfile] = useState<{userId:string; entries:FollowPreference[]}|null>(null);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const reading = useRef<AbortController|null>(null);
  const writing = useRef<AbortController|null>(null);
  useEffect(() => {
    try {
      const watched: unknown = JSON.parse(localStorage.getItem(watchStorage) || '[]');
      const follows: unknown = JSON.parse(localStorage.getItem(followStorage) || '[]');
      setGuest({
        watched:Array.isArray(watched) ? [...new Set(watched.filter(item=>typeof item==='string'))] : [],
        follows:Array.isArray(follows) ? [...new Map(follows.filter(item=>isFollowPreference({
          ...item,kind:item?.id===item?.league?'league':'team',
        })).map(item=>[item.id,item])).values()] : [],
      });
    } catch {}
    setGuestReady(true);
  }, []);
  useEffect(()=>{
    if (!guestReady) return;
    try {
      localStorage.setItem(watchStorage,JSON.stringify(guest.watched));
      localStorage.setItem(followStorage,JSON.stringify(guest.follows));
    } catch {}
  },[guest,guestReady]);

  const refresh = useCallback(async () => {
    if (!userId || reading.current || writing.current) return;
    const controller = new AbortController();
    reading.current = controller;
    try {
      const {follows} = await api<{follows:FollowPreference[]}>('/api/account/follows',{signal:controller.signal});
      if (!controller.signal.aborted) {
        setProfile({userId,entries:follows});
        setError('');
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (reading.current===controller) reading.current=null;
    }
  },[userId]);
  useEffect(()=>{
    setError('');
    setSaving(false);
    if (!userId) {
      setProfile(null);
      return;
    }
    void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus',onVisibility);
    document.addEventListener('visibilitychange',onVisibility);
    return () => {
      reading.current?.abort();
      reading.current=null;
      writing.current?.abort();
      writing.current=null;
      window.removeEventListener('focus',onVisibility);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[refresh,userId]);

  const entries = userId && profile?.userId===userId ? profile.entries : [];
  const ready = !accountLoading && (userId ? profile?.userId===userId : guestReady);
  const watched = userId ? entries.filter(item=>item.kind==='game').map(item=>item.id) : guest.watched;
  const follows = userId ? entries.filter(item=>item.kind!=='game') : guest.follows;
  const disabled = !ready || saving;

  async function save(changes: FollowPreference[], following: boolean) {
    if (!userId || !ready || writing.current || !changes.length) return;
    reading.current?.abort();
    reading.current=null;
    const controller = new AbortController();
    writing.current = controller;
    setSaving(true);
    setError('');
    try {
      for (let index = 0; index < changes.length; index += 8) {
        const result = await api<{follows:FollowPreference[]}>('/api/account/follows',{
          method:'PATCH',signal:controller.signal,body:JSON.stringify({entries:changes.slice(index,index+8),following}),
        });
        if (controller.signal.aborted) return;
        setProfile({userId,entries:result.follows});
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (writing.current===controller) {
        writing.current=null;
        setSaving(false);
      }
    }
  }

  function toggleWatch(event: LiveEvent) {
    if (disabled) return;
    const id = event.league+':'+event.id;
    if (userId) {
      void save([{id,league:event.league,name:event.name,kind:'game'}],!watched.includes(id));
    } else {
      setGuest(old=>({...old,watched:old.watched.includes(id)?old.watched.filter(key=>key!==id):[...old.watched,id]}));
    }
  }
  function toggleFollow(item: Follow) {
    if (disabled) return;
    if (userId) {
      void save([{...item,kind:item.id===item.league?'league':'team'}],!follows.some(row=>row.id===item.id));
    } else {
      setGuest(old=>({...old,follows:old.follows.some(row=>row.id===item.id)
        ? old.follows.filter(row=>row.id!==item.id) : [...old.follows,item]}));
    }
  }
  function importable(events: LiveEvent[], leagues: readonly {id:string}[]) {
    if (!userId || !ready) return [];
    const existing = new Set(entries.map(followKey));
    const boardGames = new Map(events.map(event=>[event.league+':'+event.id,event.name]));
    const local: FollowPreference[] = [
      ...guest.follows.map(item=>({...item,kind:item.id===item.league?'league' as const:'team' as const})),
      ...guest.watched.map(id=>({id,league:id.split(':')[0],name:boardGames.get(id) ?? `Game ${id.split(':')[1]}`,kind:'game' as const})),
    ];
    return local.filter(item=>isFollowPreference(item) && leagues.some(league=>league.id===item.league) && !existing.has(followKey(item)));
  }
  return {watched,follows,disabled,saving,error:userId?error:'',refresh,
    toggleWatch,toggleFollow,importable,save};
}
