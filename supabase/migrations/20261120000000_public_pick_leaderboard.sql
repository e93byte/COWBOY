-- Public free-pick accuracy leaderboard. Participation is explicit opt-in;
-- only aggregate settled outcomes for users with at least 10 decided events
-- are returned. This stores no tokens, stakes, prizes, or payout values.
alter table cowboy_users
  add column if not exists leaderboard_opt_in boolean not null default false;

create or replace function cowboy_session_user(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object('id', u.id, 'username', u.username,
    'email', u.email,
    'emailVerified', case when u.email is not null then u.email_verified_at is not null else null end,
    'leaderboardOptIn', u.leaderboard_opt_in))::json;
end $$;

create or replace function cowboy_lookup_user(p_username_key text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select * into u from cowboy_users where username_key = lower(p_username_key);
  if u.id is null then return null; end if;
  return json_build_object('id', u.id, 'username', u.username, 'salt', u.salt,
    'passwordHash', u.password_hash, 'leaderboardOptIn', u.leaderboard_opt_in);
end $$;

create or replace function cowboy_set_leaderboard_opt_in(p_token_hash text, p_enabled boolean)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  update cowboy_users set leaderboard_opt_in = p_enabled where id = u.id returning * into u;
  return jsonb_strip_nulls(jsonb_build_object('id', u.id, 'username', u.username,
    'email', u.email,
    'emailVerified', case when u.email is not null then u.email_verified_at is not null else null end,
    'leaderboardOptIn', u.leaderboard_opt_in))::json;
end $$;

create or replace function cowboy_public_leaderboard()
returns json language sql stable security definer set search_path = public as $$
  with per_event as (
    select user_id, league, event_id, bool_and(status = 'won') as won
    from cowboy_picks
    where status in ('won', 'lost')
    group by user_id, league, event_id
  ), ranked as (
    select u.id, u.username, count(*)::integer as decided_events,
      count(*) filter (where e.won)::integer as wins,
      count(*) filter (where e.won)::numeric / count(*)::numeric as accuracy
    from per_event e
    join cowboy_users u on u.id = e.user_id
    where u.leaderboard_opt_in = true
    group by u.id, u.username, u.username_key
    having count(*) >= 10
    order by accuracy desc, decided_events desc, u.username_key asc
    limit 25
  )
  select coalesce(json_agg(json_build_object(
    'rank', row_number, 'username', username, 'decidedEvents', decided_events,
    'wins', wins, 'accuracy', accuracy
  ) order by row_number), '[]'::json)
  from (
    select row_number() over (order by accuracy desc, decided_events desc, username asc) as row_number,
      username, decided_events, wins, accuracy
    from ranked
  ) entries;
$$;

create or replace function cowboy_export_account(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  return json_build_object(
    'user', jsonb_strip_nulls(jsonb_build_object('id', u.id, 'username', u.username,
      'email', u.email,
      'emailVerified', case when u.email is not null then u.email_verified_at is not null else null end,
      'leaderboardOptIn', u.leaderboard_opt_in))::jsonb,
    'follows', u.follows,
    'tickets', cowboy_list_picks(p_token_hash)
  );
end $$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. Keep all
-- account/pick RPCs behind the server-only service role, including this
-- migration's leaderboard RPCs. SECURITY DEFINER remains for atomic writes,
-- but is never directly available to anon/authenticated API clients.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cowboy\_%' escape '\'
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
