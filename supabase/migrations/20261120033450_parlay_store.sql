-- COWBOY parlay store — Supabase/Postgres schema.
-- Access is service-role only: RLS is enabled with no public policies.
-- All mutations go through SECURITY DEFINER functions so each operation is atomic.

create table if not exists cowboy_parlays (
  id text primary key,
  user_id uuid not null references cowboy_users(id) on delete cascade,
  legs jsonb not null,
  entry_id text not null,
  created_at timestamptz not null,
  status text not null check (status in ('open','won','lost','void','cancelled')),
  settled_at timestamptz,
  combined_odds numeric not null default 0,
  stake numeric not null default 100,
  potential_payout numeric not null default 0
);
create index if not exists cowboy_parlays_user_idx on cowboy_parlays(user_id);
create index if not exists cowboy_parlays_status_idx on cowboy_parlays(status) where status = 'open';

alter table cowboy_parlays enable row level security;
-- No policies: anon/authenticated roles get nothing; service_role bypasses RLS.

-- ---------- helpers ----------
drop function if exists cowboy_parlay_json(cowboy_parlays);
create or replace function cowboy_parlay_json(p cowboy_parlays)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'legs', p.legs, 'entryId', p.entry_id,
    'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', p.status,
    'settledAt', case when p.settled_at is null then null else to_char(p.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  );
$$;

create or replace function cowboy_list_parlays(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  return coalesce((
    select json_agg(cowboy_parlay_json(p) order by p.created_at desc)
    from cowboy_parlays p where p.user_id = u.id
  ), '[]'::json);
end $$;

-- Atomic parlay submission.
create or replace function cowboy_save_parlay(
  p_token_hash text, p_parlay_id text, p_legs jsonb, p_entry_id text,
  p_user_id text, p_created_at text, p_status text,
  p_combined_odds numeric, p_stake numeric, p_potential_payout numeric
) returns json language plpgsql security definer set search_path = public as $$
declare
  u cowboy_users; t cowboy_parlays;
begin
  u := cowboy_require_user(p_token_hash);
  insert into cowboy_parlays (id, user_id, legs, entry_id, created_at, status, settled_at, combined_odds, stake, potential_payout)
  values (
    p_parlay_id, u.id, p_legs, p_entry_id,
    (p_created_at)::timestamptz, p_status,
    null, p_combined_odds, p_stake, p_potential_payout
  )
  on conflict (id) do nothing
  returning * into t;
  -- If conflict (shouldn't happen with unique IDs), fetch existing
  if t.id is null then
    select * into t from cowboy_parlays where id = p_parlay_id and user_id = u.id;
  end if;
  return cowboy_parlay_json(t)::json;
end $$;

-- Settlement batch: p_updates = [{id, status, settledAt}]
create or replace function cowboy_settle_parlays(p_token_hash text, p_updates jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; upd jsonb;
begin
  u := cowboy_require_user(p_token_hash);
  for upd in select * from jsonb_array_elements(p_updates) loop
    update cowboy_parlays set status = upd->>'status', settled_at = (upd->>'settledAt')::timestamptz
    where id = upd->>'id' and user_id = u.id and status = 'open';
  end loop;
  return cowboy_list_parlays(p_token_hash);
end $$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. Keep all
-- account/parlay RPCs behind the server-only service role.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cowboy_parlay_json', 'cowboy_list_parlays', 'cowboy_save_parlay', 'cowboy_settle_parlays')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then
      execute format('revoke all on function %s from anon', fn.signature);
    end if;
    if to_regrole('authenticated') is not null then
      execute format('revoke all on function %s from authenticated', fn.signature);
    end if;
    if to_regrole('service_role') is not null then
      execute format('grant execute on function %s to service_role', fn.signature);
    end if;
  end loop;
end $$;