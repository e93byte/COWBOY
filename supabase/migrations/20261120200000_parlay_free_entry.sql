-- COWBOY parlays are free-to-play entries: no stake, no payout, no cash value.
-- Remove the simulated stake/payout columns added in 20261120033450 and the
-- matching RPC parameters so the model cannot imply wagering.

alter table cowboy_parlays drop column if exists stake;
alter table cowboy_parlays drop column if exists potential_payout;

drop function if exists cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric, numeric, numeric);

create or replace function cowboy_save_parlay(
  p_token_hash text, p_parlay_id text, p_legs jsonb, p_entry_id text,
  p_user_id text, p_created_at text, p_status text,
  p_combined_odds numeric
) returns json language plpgsql security definer set search_path = public as $$
declare
  u cowboy_users; t cowboy_parlays;
begin
  u := cowboy_require_user(p_token_hash);
  insert into cowboy_parlays (id, user_id, legs, entry_id, created_at, status, settled_at, combined_odds)
  values (
    p_parlay_id, u.id, p_legs, p_entry_id,
    (p_created_at)::timestamptz, p_status,
    null, p_combined_odds
  )
  on conflict (id) do nothing
  returning * into t;
  if t.id is null then
    select * into t from cowboy_parlays where id = p_parlay_id and user_id = u.id;
  end if;
  return cowboy_parlay_json(t)::json;
end $$;

do $$
begin
  revoke all on function cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric) from public;
  if to_regrole('anon') is not null then
    revoke all on function cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric) from anon;
  end if;
  if to_regrole('authenticated') is not null then
    revoke all on function cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric) from authenticated;
  end if;
  grant execute on function cowboy_save_parlay(text, text, jsonb, text, text, text, text, numeric) to service_role;
end $$;
