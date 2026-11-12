-- 2) Account e LLM automatico: profili con chiave OpenRouter cifrata, partite collegate
--    al proprietario, stato del turno dell'LLM e funzioni RPC aggiornate.
--    La chiave OpenRouter è cifrata dal server (AES-256-GCM, KEY_ENC_SECRET su Vercel):
--    il database non vede mai la chiave in chiaro.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  openrouter_key_enc text,
  key_last4 text,
  default_model text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;

alter table public.games
  add column owner_id uuid references auth.users(id) on delete set null,
  add column llm_model text,
  add column llm_thinking_at timestamptz,
  add column llm_last_reply text,
  add column llm_error text;
create index games_owner_idx on public.games(owner_id, created_at desc);

create or replace function public.chess_create(secret text, game jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  insert into public.games (id, white_kind, black_kind, white_token, black_token, white_name, black_name, owner_id, llm_model)
  values (game->>'id', coalesce(game->>'white_kind','human'), coalesce(game->>'black_kind','human'),
          game->>'white_token', game->>'black_token', game->>'white_name', game->>'black_name',
          nullif(game->>'owner_id','')::uuid, game->>'llm_model')
  returning * into g;
  return g;
end $$;

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
    llm_thinking_at = case when patch ? 'llm_thinking_at' then (patch->>'llm_thinking_at')::timestamptz else llm_thinking_at end,
    llm_last_reply  = case when patch ? 'llm_last_reply' then patch->>'llm_last_reply' else llm_last_reply end,
    llm_error       = case when patch ? 'llm_error' then patch->>'llm_error' else llm_error end,
    version = version + 1,
    updated_at = now()
  where id = game_id and version = expected_version
  returning * into g;
  return g;
end $$;

create or replace function public.chess_list_games(secret text, uid uuid) returns setof public.games
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  return query select * from public.games where owner_id = uid order by created_at desc limit 30;
end $$;

create or replace function public.chess_profile_get(secret text, uid uuid) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  perform public._chess_auth(secret);
  select * into p from public.profiles where user_id = uid;
  return p;
end $$;

create or replace function public.chess_profile_set(secret text, uid uuid, patch jsonb) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  perform public._chess_auth(secret);
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  update public.profiles set
    openrouter_key_enc = case when patch ? 'openrouter_key_enc' then patch->>'openrouter_key_enc' else openrouter_key_enc end,
    key_last4          = case when patch ? 'key_last4' then patch->>'key_last4' else key_last4 end,
    default_model      = case when patch ? 'default_model' then patch->>'default_model' else default_model end,
    updated_at = now()
  where user_id = uid
  returning * into p;
  return p;
end $$;

grant execute on function public.chess_create(text, jsonb), public.chess_update(text, text, integer, jsonb),
  public.chess_list_games(text, uuid), public.chess_profile_get(text, uuid), public.chess_profile_set(text, uuid, jsonb) to anon;
