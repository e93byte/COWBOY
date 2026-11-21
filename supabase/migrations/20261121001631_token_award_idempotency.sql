-- Token awards are non-cash engagement rewards.  A unique award key makes
-- retries and concurrent refreshes safe: a settled pick can earn only once.

alter table cowboy_users alter column tokens set default 100;

alter table cowboy_token_ledger add column if not exists award_key text;
alter table cowboy_token_ledger drop constraint if exists cowboy_token_ledger_award_key_check;
alter table cowboy_token_ledger add constraint cowboy_token_ledger_award_key_check
  check (award_key is null or award_key ~ '^[a-z][a-z0-9_:-]{2,160}$');
create unique index if not exists cowboy_token_ledger_user_award_key_idx
  on cowboy_token_ledger (user_id, award_key) where award_key is not null;

create or replace function cowboy_user_tokens(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users; ledger json;
begin
  u := cowboy_require_user(p_token_hash);
  select coalesce(json_agg(jsonb_strip_nulls(jsonb_build_object(
    'amount', amount, 'reason', reason, 'awardKey', award_key,
    'at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )) order by created_at desc), '[]'::json) into ledger
  from cowboy_token_ledger where user_id = u.id;
  return jsonb_build_object('tokens', u.tokens, 'ledger', ledger)::json;
end $$;

-- Existing accounts created before rewards received a referral code keep their
-- existing balance; only future accounts receive the documented starter grant.
create or replace function cowboy_register(p_username text, p_username_key text, p_salt text, p_password_hash text, p_token_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; v_referral_code text;
begin
  v_referral_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into cowboy_users (username, username_key, salt, password_hash, tokens, referral_code)
  values (p_username, p_username_key, p_salt, p_password_hash, 100, v_referral_code)
  on conflict (username_key) do nothing
  returning * into u;
  if u.id is null then raise exception 'username_taken' using errcode = 'P0001'; end if;
  insert into cowboy_sessions (token_hash, user_id, expires_at)
  values (p_token_hash, u.id, now() + interval '7 days');
  insert into cowboy_token_ledger (user_id, amount, reason, award_key)
  values (u.id, 100, 'signup_bonus', 'signup_bonus');
  return jsonb_strip_nulls(jsonb_build_object(
    'id', u.id, 'username', u.username, 'tokens', u.tokens, 'referralCode', u.referral_code,
    'leaderboardOptIn', u.leaderboard_opt_in))::json;
end $$;

create or replace function cowboy_session_user(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', u.id, 'username', u.username, 'email', u.email,
    'emailVerified', case when u.email is not null then u.email_verified_at is not null else null end,
    'leaderboardOptIn', u.leaderboard_opt_in, 'tokens', u.tokens, 'referralCode', u.referral_code))::json;
end $$;

drop function if exists cowboy_award_tokens(text, integer, text);
create function cowboy_award_tokens(p_token_hash text, p_amount integer, p_reason text, p_award_key text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; granted integer;
begin
  u := cowboy_require_user(p_token_hash);
  if p_amount <= 0 or p_reason !~ '^[a-z][a-z0-9_:-]{2,160}$' or p_award_key !~ '^[a-z][a-z0-9_:-]{2,160}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
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

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cowboy_register', 'cowboy_session_user', 'cowboy_award_tokens')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then execute format('revoke all on function %s from anon', fn.signature); end if;
    if to_regrole('authenticated') is not null then execute format('revoke all on function %s from authenticated', fn.signature); end if;
    if to_regrole('service_role') is not null then execute format('grant execute on function %s to service_role', fn.signature); end if;
  end loop;
end $$;
