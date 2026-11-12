-- 8) Impostazione dell'account: chiedere ai modelli che lo supportano di ragionare prima della mossa
--    (il ragionamento viene poi mostrato a parte nella partita). Attiva di default.

alter table public.profiles add column llm_reasoning boolean not null default true;

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
    llm_reasoning      = case when patch ? 'llm_reasoning' then (patch->>'llm_reasoning')::boolean else llm_reasoning end,
    updated_at = now()
  where user_id = uid
  returning * into p;
  return p;
end $$;
