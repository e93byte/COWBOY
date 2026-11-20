-- COWBOY account & pick store — Supabase/Postgres schema.
-- Access is service-role only: RLS is enabled with no public policies.
-- All mutations go through SECURITY DEFINER functions so each operation is atomic.

create table if not exists cowboy_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_key text not null unique,
  salt text not null,
  password_hash text not null,
  follows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cowboy_sessions (
  token_hash text primary key,
  user_id uuid not null references cowboy_users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists cowboy_sessions_user_idx on cowboy_sessions(user_id);

create table if not exists cowboy_picks (
  id uuid primary key,
  user_id uuid not null references cowboy_users(id) on delete cascade,
  request_id text not null,
  league text not null,
  event_id text not null,
  event_name text not null,
  selection text not null,
  side text not null check (side in ('home','away','draw')),
  starts_at timestamptz not null,
  created_at timestamptz not null,
  status text not null check (status in ('open','won','lost','void','cancelled')),
  settled_at timestamptz,
  changes jsonb,
  home_id text not null,
  away_id text not null,
  entry_id uuid,
  entry_index integer,
  entry_size integer,
  unique (user_id, request_id),
  unique (user_id, league, event_id)
);
create index if not exists cowboy_picks_user_idx on cowboy_picks(user_id);
create index if not exists cowboy_picks_status_idx on cowboy_picks(status) where status = 'open';

alter table cowboy_users enable row level security;
alter table cowboy_sessions enable row level security;
alter table cowboy_picks enable row level security;
-- No policies: anon/authenticated roles get nothing; service_role bypasses RLS.

-- ---------- helpers ----------
create or replace function cowboy_require_user(p_token_hash text)
returns cowboy_users language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  return u;
end $$;

-- ---------- auth ----------
create or replace function cowboy_lookup_user(p_username_key text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select * into u from cowboy_users where username_key = lower(p_username_key);
  if u.id is null then return null; end if;
  return json_build_object('id', u.id, 'username', u.username, 'salt', u.salt, 'passwordHash', u.password_hash);
end $$;

create or replace function cowboy_register(p_username text, p_username_key text, p_salt text, p_password_hash text, p_token_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users;
begin
  insert into cowboy_users (username, username_key, salt, password_hash)
  values (p_username, p_username_key, p_salt, p_password_hash)
  on conflict (username_key) do nothing
  returning * into u;
  if u.id is null then raise exception 'username_taken' using errcode = 'P0001'; end if;
  insert into cowboy_sessions (token_hash, user_id, expires_at)
  values (p_token_hash, u.id, now() + interval '7 days');
  return json_build_object('id', u.id, 'username', u.username);
end $$;

create or replace function cowboy_create_session(p_user_id uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cowboy_sessions (token_hash, user_id, expires_at)
  values (p_token_hash, p_user_id, now() + interval '7 days');
end $$;

create or replace function cowboy_session_user(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return json_build_object('id', u.id, 'username', u.username);
end $$;

create or replace function cowboy_logout(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  delete from cowboy_sessions where token_hash = p_token_hash;
$$;

create or replace function cowboy_revoke_other_sessions(p_token_hash text)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid; n integer;
begin
  select user_id into uid from cowboy_sessions where token_hash = p_token_hash;
  if uid is null then return 0; end if;
  with del as (
    delete from cowboy_sessions where user_id = uid and token_hash <> p_token_hash returning 1
  ) select count(*) into n from del;
  return n;
end $$;

create or replace function cowboy_delete_account(p_token_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from cowboy_sessions where token_hash = p_token_hash and expires_at > now();
  if uid is null then raise exception 'unauthorized' using errcode = 'P0001'; end if;
  delete from cowboy_users where id = uid; -- cascades sessions + picks
end $$;

create or replace function cowboy_session_credentials(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return json_build_object('id', u.id, 'username', u.username, 'salt', u.salt, 'passwordHash', u.password_hash);
end $$;

-- ---------- follows ----------
create or replace function cowboy_get_follows(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  return u.follows;
end $$;

create or replace function cowboy_set_follows(p_token_hash text, p_follows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  update cowboy_users set follows = p_follows where id = u.id;
  return p_follows;
end $$;

-- ---------- picks ----------
-- Single pick row → the camelCase JSON shape the TypeScript store expects.
drop function if exists cowboy_pick_json(cowboy_picks);
create or replace function cowboy_pick_json(p cowboy_picks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'requestId', p.request_id, 'eventId', p.event_id, 'league', p.league,
    'eventName', p.event_name, 'selection', p.selection, 'side', p.side, 'homeId', p.home_id, 'awayId', p.away_id,
    'startsAt', to_char(p.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', p.status,
    'settledAt', case when p.settled_at is null then null else to_char(p.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'changes', p.changes, 'entryId', p.entry_id, 'entryIndex', p.entry_index, 'entrySize', p.entry_size
  );
$$;

create or replace function cowboy_list_picks(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  return coalesce((
    select json_agg(cowboy_pick_json(p) order by p.created_at desc)
    from cowboy_picks p where p.user_id = u.id
  ), '[]'::json);
end $$;

-- Consensus input: minimal fields for buildPickConsensus, computed server-side.
create or replace function cowboy_consensus_rows()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'userId', user_id, 'eventId', event_id, 'league', league, 'side', side,
    'status', status, 'changes', changes, 'createdAt', created_at, 'updatedAt', settled_at
  )), '[]'::json) from cowboy_picks;
$$;

-- Atomic batch pick submission. p_picks: [{eventId,league,side,requestId,eventName,selection,startsAt,homeId,awayId,createdAt}]
create or replace function cowboy_save_picks(p_token_hash text, p_picks jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u cowboy_users; pick jsonb; t cowboy_picks; results jsonb := '[]'::jsonb;
  entry uuid := gen_random_uuid(); n integer := jsonb_array_length(p_picks); i integer := 0;
  all_replayed boolean;
begin
  u := cowboy_require_user(p_token_hash);
  -- Idempotent retry: when every leg already exists with the same side, return
  -- the stored tickets in input order instead of erroring.
  select bool_and(exists (
    select 1 from cowboy_picks cp
    where cp.user_id = u.id and cp.request_id = p->>'requestId'
      and cp.league = p->>'league' and cp.event_id = p->>'eventId'
      and coalesce(cp.changes->0->>'side', cp.side) = p->>'side')) into all_replayed
  from jsonb_array_elements(p_picks) p;
  if n > 1 and all_replayed then
    for pick in select value from jsonb_array_elements(p_picks) loop
      select * into t
      from cowboy_picks cp
      where cp.user_id = u.id and cp.request_id = pick->>'requestId' limit 1;
      results := results || cowboy_pick_json(t);
    end loop;
    return results::json;
  end if;
  for pick in select value from jsonb_array_elements(p_picks) loop
    i := i + 1;
    if exists (select 1 from cowboy_picks where user_id = u.id and request_id = pick->>'requestId') then
      raise exception 'request_replayed' using errcode = 'P0001';
    end if;
    if exists (select 1 from cowboy_picks where user_id = u.id and league = pick->>'league' and event_id = pick->>'eventId') then
      raise exception 'duplicate_pick' using errcode = 'P0001';
    end if;
    insert into cowboy_picks (id, user_id, request_id, league, event_id, event_name, selection, side,
      starts_at, created_at, status, home_id, away_id, entry_id, entry_index, entry_size)
    values (gen_random_uuid(), u.id, pick->>'requestId', pick->>'league', pick->>'eventId',
      pick->>'eventName', pick->>'selection', pick->>'side', (pick->>'startsAt')::timestamptz, (pick->>'createdAt')::timestamptz,
      'open', pick->>'homeId', pick->>'awayId',
      case when n > 1 then entry end,
      case when n > 1 then i - 1 end,
      case when n > 1 then n end)
    returning * into t;
    results := results || cowboy_pick_json(t);
  end loop;
  return results::json;
end $$;

-- Cancel or edit an open pick. p_action: 'cancel' | 'edit'; p_side/p_revision for edit.
create or replace function cowboy_change_pick(p_token_hash text, p_ticket_id uuid, p_action text, p_side text, p_revision integer, p_selection text, p_now timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; t cowboy_picks;
begin
  u := cowboy_require_user(p_token_hash);
  select * into t from cowboy_picks where id = p_ticket_id and user_id = u.id for update;
  if t.id is null then raise exception 'ticket_unavailable' using errcode = 'P0001'; end if;
  if t.status <> 'open' or t.starts_at <= p_now then raise exception 'event_locked' using errcode = 'P0001'; end if;
  if p_action = 'cancel' then
    update cowboy_picks set status = 'cancelled', settled_at = p_now where id = t.id;
  elsif p_action = 'edit' then
    if coalesce(jsonb_array_length(t.changes), 0) <> p_revision then
      raise exception 'pick_changed' using errcode = 'P0001';
    end if;
    if t.side <> p_side then
      update cowboy_picks set
        changes = coalesce(t.changes, '[]'::jsonb) || jsonb_build_object('side', t.side, 'selection', t.selection, 'changedAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        side = p_side, selection = p_selection
      where id = t.id;
    end if;
  else
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  select * into t from cowboy_picks where id = t.id;
  return cowboy_pick_json(t)::json;
end $$;

-- Settlement batch: p_updates = [{id, status, settledAt}]
create or replace function cowboy_settle_picks(p_token_hash text, p_updates jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; upd jsonb;
begin
  u := cowboy_require_user(p_token_hash);
  for upd in select * from jsonb_array_elements(p_updates) loop
    update cowboy_picks set status = upd->>'status', settled_at = (upd->>'settledAt')::timestamptz
    where id = (upd->>'id')::uuid and user_id = u.id and status = 'open';
  end loop;
  return cowboy_list_picks(p_token_hash);
end $$;

-- Full account export (data-handlers).
create or replace function cowboy_export_account(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  return json_build_object(
    'user', json_build_object('id', u.id, 'username', u.username),
    'follows', u.follows,
    'tickets', cowboy_list_picks(p_token_hash)
  );
end $$;
