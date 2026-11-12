-- Schema del database (Supabase / Postgres).
-- Le tabelle non sono accessibili direttamente: il sito passa solo dalle funzioni chess_*,
-- che richiedono il segreto del server (CHESS_SERVER_SECRET su Vercel).
-- Dopo aver eseguito questo file, salva l'hash del segreto:
--   insert into public.app_config(key, value)
--   values ('server_secret_sha256', encode(sha256(convert_to('<IL_TUO_SEGRETO>', 'UTF8')), 'hex'));

create table public.games (
  id text primary key,
  moves text[] not null default '{}',
  white_kind text not null default 'human' check (white_kind in ('human','llm')),
  black_kind text not null default 'human' check (black_kind in ('human','llm')),
  white_token text,
  black_token text,
  white_name text,
  black_name text,
  result text,
  reason text,
  draw_offer text,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.games enable row level security;

create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;

create or replace function public._chess_auth(secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if encode(sha256(convert_to(coalesce(secret,''), 'UTF8')), 'hex') is distinct from
     (select value from public.app_config where key = 'server_secret_sha256') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

create or replace function public.chess_get(secret text, game_id text) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  select * into g from public.games where id = game_id;
  return g;
end $$;

create or replace function public.chess_create(secret text, game jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  insert into public.games (id, white_kind, black_kind, white_token, black_token, white_name, black_name)
  values (game->>'id', coalesce(game->>'white_kind','human'), coalesce(game->>'black_kind','human'),
          game->>'white_token', game->>'black_token', game->>'white_name', game->>'black_name')
  returning * into g;
  return g;
end $$;

-- Aggiornamento con controllo di versione: ritorna null se nel frattempo qualcuno ha scritto.
create or replace function public.chess_update(secret text, game_id text, expected_version integer, patch jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  update public.games set
    moves       = case when patch ? 'moves' then array(select jsonb_array_elements_text(patch->'moves')) else moves end,
    white_token = case when patch ? 'white_token' then patch->>'white_token' else white_token end,
    black_token = case when patch ? 'black_token' then patch->>'black_token' else black_token end,
    white_name  = case when patch ? 'white_name' then patch->>'white_name' else white_name end,
    black_name  = case when patch ? 'black_name' then patch->>'black_name' else black_name end,
    result      = case when patch ? 'result' then patch->>'result' else result end,
    reason      = case when patch ? 'reason' then patch->>'reason' else reason end,
    draw_offer  = case when patch ? 'draw_offer' then patch->>'draw_offer' else draw_offer end,
    version = version + 1,
    updated_at = now()
  where id = game_id and version = expected_version
  returning * into g;
  return g;
end $$;

revoke all on function public._chess_auth(text) from public, anon, authenticated;
revoke all on table public.games, public.app_config from anon, authenticated;
grant execute on function public.chess_get(text, text), public.chess_create(text, jsonb),
  public.chess_update(text, text, integer, jsonb) to anon;
