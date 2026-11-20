-- COWBOY contests — free-to-play prediction contests.
-- Users join a contest and are ranked by pick accuracy over the contest window.
-- No entry fee, no prize payout, no real money — purely a leaderboard overlay.

create table if not exists cowboy_contests (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('daily','weekly','seasonal')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  league text, -- null = all leagues
  status text not null default 'upcoming' check (status in ('upcoming','active','settled')),
  created_at timestamptz not null default now()
);
create index if not exists cowboy_contests_status_idx on cowboy_contests(status);
create index if not exists cowboy_contests_window_idx on cowboy_contests(starts_at, ends_at);

create table if not exists cowboy_contest_entries (
  user_id uuid not null references cowboy_users(id) on delete cascade,
  contest_id text not null references cowboy_contests(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (user_id, contest_id)
);
create index if not exists cowboy_contest_entries_contest_idx on cowboy_contest_entries(contest_id);

alter table cowboy_contests enable row level security;
alter table cowboy_contest_entries enable row level security;

-- ---------- helpers ----------
create or replace function cowboy_contest_json(c cowboy_contests)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'kind', c.kind,
    'startsAt', to_char(c.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endsAt', to_char(c.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'league', c.league, 'status', c.status, 'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

-- List visible contests (upcoming/active/settled).
create or replace function cowboy_list_contests()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(cowboy_contest_json(c) order by c.starts_at desc), '[]'::json)
  from cowboy_contests c
  where c.status in ('upcoming','active','settled');
$$;

-- Join a contest. Idempotent.
create or replace function cowboy_join_contest(p_token_hash text, p_contest_id text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; c cowboy_contests;
begin
  u := cowboy_require_user(p_token_hash);
  select * into c from cowboy_contests where id = p_contest_id;
  if c.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if c.status <> 'upcoming' then raise exception 'contest_locked' using errcode = 'P0001'; end if;
  insert into cowboy_contest_entries (user_id, contest_id)
  values (u.id, p_contest_id)
  on conflict (user_id, contest_id) do nothing;
  return jsonb_build_object('id', c.id, 'title', c.title, 'joined', true)::json;
end $$;

-- Contest standings: rank joined users by accuracy on settled picks in window.
-- Only users with leaderboard_opt_in and at least 5 decided picks qualify.
create or replace function cowboy_contest_standings(p_contest_id text)
returns json language sql stable security definer set search_path = public as $$
  with window_picks as (
    select cp.user_id, cp.league, cp.event_id, cp.market, cp.side, cp.line, cp.status
    from cowboy_picks cp
    join cowboy_contest_entries ce on ce.user_id = cp.user_id and ce.contest_id = p_contest_id
    where cp.status in ('won','lost','void')
      and ((select league from cowboy_contests where id = p_contest_id) is null
           or cp.league = (select league from cowboy_contests where id = p_contest_id))
      and cp.created_at >= (select starts_at from cowboy_contests where id = p_contest_id)
      and cp.created_at <= (select ends_at from cowboy_contests where id = p_contest_id)
  ), per_user as (
    select user_id,
      count(*) filter (where status <> 'void') as decided,
      count(*) filter (where status = 'won') as wins,
      count(*) filter (where status = 'won')::numeric / nullif(count(*) filter (where status <> 'void'),0) as accuracy
    from window_picks
    group by user_id
    having count(*) filter (where status <> 'void') >= 5
  )
  select coalesce(json_agg(json_build_object(
    'rank', row_number, 'username', username, 'decidedEvents', decided,
    'wins', wins, 'accuracy', round(accuracy * 100) / 100
  ) order by accuracy desc nulls last, decided desc, wins desc, username asc), '[]'::json)
  from (
    select row_number() over (order by pu.accuracy desc nulls last, pu.decided desc, pu.wins desc, u.username asc) as row_number,
      u.username, pu.decided, pu.wins, pu.accuracy
    from per_user pu
    join cowboy_users u on u.id = pu.user_id and u.leaderboard_opt_in
  ) s;
$$;

-- Seed a default daily contest (idempotent).
insert into cowboy_contests (id, title, kind, starts_at, ends_at, league, status)
values (
  'daily-' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
  'Daily Free Pick Contest',
  'daily',
  date_trunc('day', now() at time zone 'UTC'),
  (date_trunc('day', now() at time zone 'UTC') + interval '1 day') - interval '1 second',
  null, 'active'
) on conflict (id) do nothing;

-- Keep contest RPCs behind the server-only service role.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cowboy_contest_json','cowboy_list_contests','cowboy_join_contest','cowboy_contest_standings')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then execute format('revoke all on function %s from anon', fn.signature); end if;
    if to_regrole('authenticated') is not null then execute format('revoke all on function %s from authenticated', fn.signature); end if;
    if to_regrole('service_role') is not null then execute format('grant execute on function %s to service_role', fn.signature); end if;
  end loop;
end $$;
