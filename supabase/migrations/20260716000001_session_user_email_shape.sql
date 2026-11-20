-- Keep the session-user payload backward compatible: email fields only
-- appear once an account has an email on file.
create or replace function cowboy_session_user(p_token_hash text)
returns json language plpgsql stable security definer set search_path = public as $$
declare u cowboy_users;
begin
  select usr.* into u
  from cowboy_sessions s join cowboy_users usr on usr.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
  if u.id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', u.id, 'username', u.username,
    'email', u.email,
    'emailVerified', case when u.email is not null then u.email_verified_at is not null else null end
  ))::json;
end $$;
