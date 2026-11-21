-- COWBOY chips — optional play-money stakes on free picks and parlays.
-- Chips have no cash value, cannot be purchased, and cannot be redeemed.
-- Signup grants 5,000 chips; staked picks escrow chips at submission and
-- settle to a chip payout (or refund on void/cancel) at confirmation.

alter table cowboy_users alter column tokens set default 5000;
alter table cowboy_picks add column if not exists chip_stake integer not null default 0;
alter table cowboy_parlays add column if not exists chip_stake integer not null default 0;
alter table cowboy_picks drop constraint if exists cowboy_picks_chip_stake_check;
alter table cowboy_picks add constraint cowboy_picks_chip_stake_check check (chip_stake >= 0);
alter table cowboy_parlays drop constraint if exists cowboy_parlays_chip_stake_check;
alter table cowboy_parlays add constraint cowboy_parlays_chip_stake_check check (chip_stake >= 0);

-- ---------- register: 5,000 chip starter grant ----------
create or replace function cowboy_register(p_username text, p_username_key text, p_salt text, p_password_hash text, p_token_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; v_referral_code text;
begin
  v_referral_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into cowboy_users (username, username_key, salt, password_hash, tokens, referral_code)
  values (p_username, p_username_key, p_salt, p_password_hash, 5000, v_referral_code)
  on conflict (username_key) do nothing
  returning * into u;
  if u.id is null then raise exception 'username_taken' using errcode = 'P0001'; end if;
  insert into cowboy_sessions (token_hash, user_id, expires_at)
  values (p_token_hash, u.id, now() + interval '7 days');
  insert into cowboy_token_ledger (user_id, amount, reason, award_key)
  values (u.id, 5000, 'signup_bonus', 'signup_bonus');
  return jsonb_strip_nulls(jsonb_build_object(
    'id', u.id, 'username', u.username, 'tokens', u.tokens, 'referralCode', u.referral_code,
    'leaderboardOptIn', u.leaderboard_opt_in))::json;
end $$;

-- ---------- signed chip adjustment (escrow debit / settlement credit) ----------
-- p_amount may be negative; the balance can never drop below zero.
-- award_key idempotency makes retries and double-settlement safe.
create or replace function cowboy_adjust_tokens(p_token_hash text, p_amount integer, p_reason text, p_award_key text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; granted integer;
begin
  u := cowboy_require_user(p_token_hash);
  if p_amount = 0 or p_reason !~ '^[a-z][a-z0-9_:-]{2,160}$' or p_award_key !~ '^[a-z][a-z0-9_:-]{2,160}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if u.tokens + p_amount < 0 then
    raise exception 'insufficient_chips' using errcode = 'P0001';
  end if;
  insert into cowboy_token_ledger (user_id, amount, reason, award_key)
  values (u.id, p_amount, p_reason, p_award_key)
  on conflict (user_id, award_key) where award_key is not null do nothing
  returning amount into granted;
  if granted is not null then
    update cowboy_users set tokens = tokens + granted where id = u.id returning * into u;
  end if;
  return json_build_object('tokens', u.tokens);
end $$;

-- ---------- picks: carry chipStake ----------
create or replace function cowboy_pick_json(p cowboy_picks)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'requestId', p.request_id, 'eventId', p.event_id, 'league', p.league,
    'eventName', p.event_name, 'selection', p.selection, 'side', p.side, 'market', p.market, 'line', p.line,
    'prop', p.prop, 'live', p.live, 'odds', p.odds, 'chipStake', p.chip_stake,
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
      market, line, prop, live, odds, chip_stake, starts_at, created_at, status, home_id, away_id, entry_id, entry_index, entry_size)
    values (gen_random_uuid(), u.id, pick->>'requestId', pick->>'league', pick->>'eventId',
      pick->>'eventName', pick->>'selection', pick->>'side',
      coalesce(pick->>'market', 'moneyline'), (pick->>'line')::double precision,
      case when pick->'prop' is null or pick->'prop' = 'null'::jsonb then null else pick->'prop' end,
      coalesce((pick->>'live')::boolean, false), (pick->>'odds')::double precision,
      greatest(0, coalesce((pick->>'chipStake')::integer, 0)),
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

-- ---------- parlays: carry chipStake ----------
create or replace function cowboy_parlay_json(p cowboy_parlays)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'legs', p.legs, 'entryId', p.entry_id,
    'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', p.status, 'combinedOdds', p.combined_odds, 'chipStake', p.chip_stake,
    'settledAt', case when p.settled_at is null then null else to_char(p.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  );
$$;

drop function if exists cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric);
create or replace function cowboy_save_parlay(
  p_token_hash text, p_parlay_id text, p_legs jsonb, p_entry_id text,
  p_user_id text, p_created_at text, p_status text,
  p_combined_odds numeric, p_chip_stake integer
) returns json language plpgsql security definer set search_path = public as $$
declare
  u cowboy_users; t cowboy_parlays;
begin
  u := cowboy_require_user(p_token_hash);
  insert into cowboy_parlays (id, user_id, legs, entry_id, created_at, status, settled_at, combined_odds, chip_stake)
  values (
    p_parlay_id, u.id, p_legs, p_entry_id,
    (p_created_at)::timestamptz, p_status,
    null, p_combined_odds, greatest(0, coalesce(p_chip_stake, 0))
  )
  on conflict (id) do nothing
  returning * into t;
  if t.id is null then
    select * into t from cowboy_parlays where id = p_parlay_id and user_id = u.id;
  end if;
  return cowboy_parlay_json(t)::json;
end $$;

-- ---------- grants ----------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'cowboy_register', 'cowboy_adjust_tokens', 'cowboy_pick_json', 'cowboy_save_picks',
      'cowboy_parlay_json', 'cowboy_save_parlay')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then execute format('revoke all on function %s from anon', fn.signature); end if;
    if to_regrole('authenticated') is not null then execute format('revoke all on function %s from authenticated', fn.signature); end if;
    if to_regrole('service_role') is not null then execute format('grant execute on function %s to service_role', fn.signature); end if;
  end loop;
end $$;
