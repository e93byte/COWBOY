-- COWBOY token economy — free reward tokens earned for settled winning picks.
-- Tokens have no cash value and cannot be purchased or redeemed for money.

alter table cowboy_users add column if not exists tokens integer not null default 0;
alter table cowboy_users add column if not exists referral_code text unique;

create table if not exists cowboy_token_ledger (
  id bigserial primary key,
  user_id uuid not null references cowboy_users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists cowboy_token_ledger_user_idx on cowboy_token_ledger(user_id);

alter table cowboy_token_ledger enable row level security;

create or replace function cowboy_user_tokens(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users; ledger json;
begin
  u := cowboy_require_user(p_token_hash);
  select coalesce(json_agg(json_build_object(
    'amount', amount, 'reason', reason, 'at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by created_at desc), '[]'::json) into ledger
  from cowboy_token_ledger where user_id = u.id;
  return jsonb_build_object('tokens', u.tokens, 'ledger', ledger)::json;
end $$;

create or replace function cowboy_award_tokens(p_token_hash text, p_amount integer, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users;
begin
  u := cowboy_require_user(p_token_hash);
  if p_amount <= 0 then raise exception 'invalid_input' using errcode = 'P0001'; end if;
  update cowboy_users set tokens = coalesce(tokens, 0) + p_amount where id = u.id;
  insert into cowboy_token_ledger (user_id, amount, reason) values (u.id, p_amount, p_reason);
  return jsonb_build_object('tokens', coalesce(u.tokens, 0) + p_amount)::json;
end $$;

-- Keep token RPCs behind the server-only service role.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cowboy_user_tokens', 'cowboy_award_tokens')
  loop
    execute format('revoke all on function %s from public', fn.signature);
    if to_regrole('anon') is not null then execute format('revoke all on function %s from anon', fn.signature); end if;
    if to_regrole('authenticated') is not null then execute format('revoke all on function %s from authenticated', fn.signature); end if;
    if to_regrole('service_role') is not null then execute format('grant execute on function %s to service_role', fn.signature); end if;
  end loop;
end $$;
