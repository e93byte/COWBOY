-- Player-prop picks and in-game (live) picks.
--   prop:  { player, stat, line, book } snapshot of the posted line
--   live:  true when entered after the event started
--   odds:  reference American price at submission (never a stake or payout)
alter table cowboy_picks add column if not exists prop jsonb;
alter table cowboy_picks add column if not exists live boolean not null default false;
alter table cowboy_picks add column if not exists odds double precision;

alter table cowboy_picks drop constraint if exists cowboy_picks_market_check;
alter table cowboy_picks add constraint cowboy_picks_market_check
  check (market in ('moneyline','spread','total','prop'));

alter table cowboy_picks drop constraint if exists cowboy_picks_prop_check;
alter table cowboy_picks add constraint cowboy_picks_prop_check
  check (market <> 'prop' or (prop is not null and prop->>'player' is not null and prop->>'stat' is not null));

create or replace function cowboy_pick_json(p cowboy_picks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'requestId', p.request_id, 'eventId', p.event_id, 'league', p.league,
    'eventName', p.event_name, 'selection', p.selection, 'side', p.side, 'market', p.market, 'line', p.line,
    'prop', p.prop, 'live', p.live, 'odds', p.odds,
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
      select * into t from cowboy_picks cp
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
      market, line, prop, live, odds, starts_at, created_at, status, home_id, away_id, entry_id, entry_index, entry_size)
    values (gen_random_uuid(), u.id, pick->>'requestId', pick->>'league', pick->>'eventId',
      pick->>'eventName', pick->>'selection', pick->>'side',
      coalesce(pick->>'market', 'moneyline'), (pick->>'line')::double precision,
      case when pick->'prop' is null or pick->'prop' = 'null'::jsonb then null else pick->'prop' end,
      coalesce((pick->>'live')::boolean, false), (pick->>'odds')::double precision,
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

-- In-game picks are locked at submission; the store refuses edits on them.
drop function if exists cowboy_change_pick(text, uuid, text, text, integer, text, double precision, timestamptz);
create or replace function cowboy_change_pick(p_token_hash text, p_ticket_id uuid, p_action text, p_side text, p_revision integer, p_selection text, p_line double precision, p_now timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; t cowboy_picks;
begin
  u := cowboy_require_user(p_token_hash);
  select * into t from cowboy_picks where id = p_ticket_id and user_id = u.id for update;
  if t.id is null then raise exception 'ticket_unavailable' using errcode = 'P0001'; end if;
  if t.status <> 'open' or t.starts_at <= p_now or t.live then raise exception 'event_locked' using errcode = 'P0001'; end if;
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

-- Keep every account RPC behind the server-only service role.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cowboy_pick_json', 'cowboy_save_picks', 'cowboy_change_pick')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then execute format('revoke all on function %s from anon', fn.signature); end if;
    if to_regrole('authenticated') is not null then execute format('revoke all on function %s from authenticated', fn.signature); end if;
    if to_regrole('service_role') is not null then execute format('grant execute on function %s to service_role', fn.signature); end if;
  end loop;
end $$;
