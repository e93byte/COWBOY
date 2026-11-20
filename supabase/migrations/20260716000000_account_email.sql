-- Account email + password reset tokens.
-- Email is optional; verification and reset tokens are single-use, hashed,
-- and expire. All access remains service-role only via SECURITY DEFINER RPCs.

alter table cowboy_users add column if not exists email text;
alter table cowboy_users add column if not exists email_verified_at timestamptz;
create unique index if not exists cowboy_users_email_key on cowboy_users(lower(email)) where email is not null;

create table if not exists cowboy_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references cowboy_users(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (purpose in ('verify_email','password_reset')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cowboy_tokens_user_idx on cowboy_tokens(user_id);
alter table cowboy_tokens enable row level security;
-- No policies: service_role only.

-- Session user now carries email status for the account UI.
create or replace function cowboy_session_user(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return json_build_object('id', u.id, 'username', u.username,
    'email', u.email, 'emailVerified', u.email_verified_at is not null);
end $$;

-- Set/replace the account email and issue a verification token.
-- Returns the stored email; the caller emails the raw token separately.
create or replace function cowboy_set_email(p_token_hash text, p_email text, p_token_hash_value text, p_ttl_seconds integer)
returns json language plpgsql security definer set search_path = public as $$
declare u cowboy_users; normalized text;
begin
  u := cowboy_require_user(p_token_hash);
  normalized := lower(btrim(p_email));
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(normalized) > 254 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if exists (select 1 from cowboy_users other where lower(other.email) = normalized and other.id <> u.id) then
    raise exception 'email_taken' using errcode = 'P0001';
  end if;
  update cowboy_users set email = normalized, email_verified_at = null where id = u.id;
  delete from cowboy_tokens where user_id = u.id and purpose = 'verify_email' and consumed_at is null;
  insert into cowboy_tokens (user_id, token_hash, purpose, expires_at)
  values (u.id, p_token_hash_value, 'verify_email', now() + make_interval(secs => p_ttl_seconds));
  return json_build_object('email', normalized);
end $$;

-- Consume a verification token; marks the matching email verified.
create or replace function cowboy_verify_email(p_token_hash_value text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t cowboy_tokens;
begin
  select * into t from cowboy_tokens
    where token_hash = p_token_hash_value and purpose = 'verify_email'
      and consumed_at is null and expires_at > now();
  if t.id is null then return false; end if;
  update cowboy_tokens set consumed_at = now() where id = t.id;
  update cowboy_users set email_verified_at = now() where id = t.user_id;
  return true;
end $$;

-- Issue a password-reset token for a username that has an email on file.
-- Returns the account email, or null when no reset should be sent
-- (unknown user or no email) so callers cannot enumerate accounts.
create or replace function cowboy_request_password_reset(p_username_key text, p_token_hash_value text, p_ttl_seconds integer)
returns text language plpgsql security definer set search_path = public as $$
declare u cowboy_users;
begin
  select * into u from cowboy_users where username_key = lower(p_username_key) and email is not null;
  if u.id is null then return null; end if;
  delete from cowboy_tokens where user_id = u.id and purpose = 'password_reset' and consumed_at is null;
  insert into cowboy_tokens (user_id, token_hash, purpose, expires_at)
  values (u.id, p_token_hash_value, 'password_reset', now() + make_interval(secs => p_ttl_seconds));
  return u.email;
end $$;

-- Consume a reset token and replace credentials; revokes all sessions.
create or replace function cowboy_reset_password(p_token_hash_value text, p_salt text, p_password_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t cowboy_tokens;
begin
  select * into t from cowboy_tokens
    where token_hash = p_token_hash_value and purpose = 'password_reset'
      and consumed_at is null and expires_at > now();
  if t.id is null then return false; end if;
  update cowboy_tokens set consumed_at = now() where id = t.id;
  update cowboy_users set salt = p_salt, password_hash = p_password_hash where id = t.user_id;
  delete from cowboy_sessions where user_id = t.user_id;
  return true;
end $$;

-- Opportunistic cleanup of expired tokens.
create or replace function cowboy_prune_tokens()
returns void language sql security definer set search_path = public as $$
  delete from cowboy_tokens where expires_at < now() - interval '1 day';
$$;
