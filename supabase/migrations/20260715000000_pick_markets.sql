-- Spread and total picks: adds market + line to cowboy_picks and widens the
-- side domain to over/under. Moneyline picks keep market='moneyline'.

alter table cowboy_picks add column if not exists market text not null default 'moneyline';
alter table cowboy_picks add column if not exists line double precision;

alter table cowboy_picks drop constraint if exists cowboy_picks_side_check;
alter table cowboy_picks add constraint cowboy_picks_side_check
  check (side in ('home','away','draw','over','under'));

-- One pick per user/league/event/market — moneyline, spread and total may
-- coexist on the same game.
alter table cowboy_picks drop constraint if exists cowboy_picks_user_id_league_event_id_key;
alter table cowboy_picks add constraint cowboy_picks_user_league_event_market_key
  unique (user_id, league, event_id, market);

create or replace function cowboy_pick_json(p cowboy_picks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'requestId', p.request_id, 'eventId', p.event_id, 'league', p.league,
    'eventName', p.event_name, 'selection', p.selection, 'side', p.side, 'market', p.market, 'line', p.line,
    'homeId', p.home_id, 'awayId', p.away_id,
    'startsAt', to_char(p.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', p.status,
    'settledAt', case when p.settled_at is null then null else to_char(p.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'changes', p.changes, 'entryId', p.entry_id, 'entryIndex', p.entry_index, 'entrySize', p.entry_size
  );
$$;

create or replace function cowboy_save_picks(p_token_hash text, p_picks jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u cowboy_users; pick jsonb; t cowboy_picks; results jsonb := '[]'::jsonb;
  entry uuid := gen_random_uuid(); n integer := jsonb_array_length(p_picks); i integer := 0;
  all_replayed boolean;
begin
  u := cowboy_require_user(p_token_hash);
  -- Idempotent retry: when every leg already exists with the same market, side
  -- and line, return the stored tickets in input order instead of erroring.
  select bool_and(exists (
    select 1 from cowboy_picks cp
    where cp.user_id = u.id and cp.request_id = p->>'requestId'
      and cp.league = p->>'league' and cp.event_id = p->>'eventId'
      and cp.market = coalesce(p->>'market', 'moneyline')
      and coalesce(cp.changes->0->>'side', cp.side) = p->>'side'
      and cp.line is not distinct from (p->>'line')::double precision)) into all_replayed
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
    if exists (select 1 from cowboy_picks where user_id = u.id and league = pick->>'league'
        and event_id = pick->>'eventId' and market = coalesce(pick->>'market', 'moneyline')) then
      raise exception 'duplicate_pick' using errcode = 'P0001';
    end if;
    insert into cowboy_picks (id, user_id, request_id, league, event_id, event_name, selection, side,
      market, line, starts_at, created_at, status, home_id, away_id, entry_id, entry_index, entry_size)
    values (gen_random_uuid(), u.id, pick->>'requestId', pick->>'league', pick->>'eventId',
      pick->>'eventName', pick->>'selection', pick->>'side',
      coalesce(pick->>'market', 'moneyline'), (pick->>'line')::double precision,
      (pick->>'startsAt')::timestamptz, (pick->>'createdAt')::timestamptz,
      'open', pick->>'homeId', pick->>'awayId',
      case when n > 1 then entry end,
      case when n > 1 then i - 1 end,
      case when n > 1 then n end)
    returning * into t;
    results := results || cowboy_pick_json(t);
  end loop;
  return results::json;
end $$;

create or replace function cowboy_consensus_rows()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'userId', user_id, 'eventId', event_id, 'league', league, 'side', side,
    'market', market, 'status', status, 'changes', changes,
    'createdAt', created_at, 'updatedAt', settled_at
  )), '[]'::json) from cowboy_picks;
$$;

-- Edit may also move the line (spread flips negate it). New signature adds
-- p_line; the old overload is dropped so PostgREST resolves one function.
drop function if exists cowboy_change_pick(text, uuid, text, text, integer, text, timestamptz);
create or replace function cowboy_change_pick(p_token_hash text, p_ticket_id uuid, p_action text, p_side text, p_revision integer, p_selection text, p_line double precision, p_now timestamptz)
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
    if t.side <> p_side or t.line is distinct from p_line then
      update cowboy_picks set
        changes = coalesce(t.changes, '[]'::jsonb) || jsonb_build_object('side', t.side, 'selection', t.selection, 'changedAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        side = p_side, selection = p_selection, line = p_line
      where id = t.id;
    end if;
  else
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  select * into t from cowboy_picks where id = t.id;
  return cowboy_pick_json(t)::json;
end $$;
