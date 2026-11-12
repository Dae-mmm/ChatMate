-- 3) Livelli degli account e funzioni per il pannello admin.
--    role: 'user' (base), 'streamer' (può attivare la modalità Twitch), 'admin' (gestisce account e partite).
--    Il primo admin va impostato a mano, vedi supabase/README.md.

alter table public.profiles
  add column role text not null default 'user' check (role in ('user', 'streamer', 'admin'));

-- Livello di un utente (chi non ha ancora un profilo è 'user')
create or replace function public.chess_role_get(secret text, uid uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  return coalesce((select role from public.profiles where user_id = uid), 'user');
end $$;

-- Ricerca account per email (vuota = più recenti)
create or replace function public.chess_admin_users(secret text, q text, lim integer default 50, off integer default 0)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean,
               role text, has_key boolean, games bigint)
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public._chess_auth(secret);
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
           coalesce(p.role, 'user'), p.openrouter_key_enc is not null,
           (select count(*) from public.games g where g.owner_id = u.id)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where coalesce(q, '') = '' or u.email ilike '%' || q || '%'
    order by u.created_at desc
    limit least(greatest(lim, 1), 200) offset greatest(off, 0);
end $$;

create or replace function public.chess_admin_set_role(secret text, uid uuid, new_role text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  if new_role not in ('user', 'streamer', 'admin') then raise exception 'invalid role'; end if;
  insert into public.profiles (user_id, role) values (uid, new_role)
  on conflict (user_id) do update set role = excluded.role, updated_at = now();
  return new_role;
end $$;

-- Elenco partite; inactive_days > 0 mostra solo quelle ferme da più di N giorni
create or replace function public.chess_admin_games(secret text, inactive_days integer default 0, lim integer default 50, off integer default 0)
returns table (id text, created_at timestamptz, updated_at timestamptz, owner_email text,
               white_name text, black_name text, white_kind text, black_kind text,
               llm_model text, moves integer, result text, total bigint)
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public._chess_auth(secret);
  return query
    select g.id, g.created_at, g.updated_at, u.email::text, g.white_name, g.black_name, g.white_kind, g.black_kind,
           g.llm_model, coalesce(array_length(g.moves, 1), 0), g.result, count(*) over ()
    from public.games g
    left join auth.users u on u.id = g.owner_id
    where coalesce(inactive_days, 0) <= 0 or g.updated_at < now() - make_interval(days => inactive_days)
    order by g.updated_at desc
    limit least(greatest(lim, 1), 200) offset greatest(off, 0);
end $$;

create or replace function public.chess_admin_delete_games(secret text, ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public._chess_auth(secret);
  delete from public.games where id = any(ids);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.chess_admin_purge_games(secret text, inactive_days integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public._chess_auth(secret);
  if inactive_days is null or inactive_days < 1 then raise exception 'inactive_days must be >= 1'; end if;
  delete from public.games where updated_at < now() - make_interval(days => inactive_days);
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.chess_role_get(text, uuid), public.chess_admin_users(text, text, integer, integer),
  public.chess_admin_set_role(text, uuid, text), public.chess_admin_games(text, integer, integer, integer),
  public.chess_admin_delete_games(text, text[]), public.chess_admin_purge_games(text, integer) to anon;
