-- 5) Chiave dell'overlay per streamer: l'indirizzo dell'overlay in OBS resta lo stesso
--    e mostra sempre l'ultima partita Twitch dello streamer.

alter table public.profiles add column live_key text unique;
create index games_live_key_idx on public.games(live_key, created_at desc) where live_key is not null;

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
    live_key           = case when patch ? 'live_key' then patch->>'live_key' else live_key end,
    updated_at = now()
  where user_id = uid
  returning * into p;
  return p;
end $$;

-- Ultima partita Twitch collegata a una chiave overlay
create or replace function public.chess_live_latest(secret text, key text) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  select * into g from public.games where live_key = key and mode = 'twitch' order by created_at desc limit 1;
  return g;
end $$;

grant execute on function public.chess_profile_set(text, uuid, jsonb), public.chess_live_latest(text, text) to anon;
