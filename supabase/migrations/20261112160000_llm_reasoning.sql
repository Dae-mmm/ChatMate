-- 7) Ragionamento dell'LLM: il testo dei "pensieri" che OpenRouter restituisce a parte rispetto alla risposta
--    (solo per i modelli che lo producono). Salvato per l'ultima mossa dell'LLM e mostrato sotto la mossa.

alter table public.games add column llm_last_reasoning text;

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
    llm_last_reasoning = case when patch ? 'llm_last_reasoning' then patch->>'llm_last_reasoning' else llm_last_reasoning end,
    llm_error       = case when patch ? 'llm_error' then patch->>'llm_error' else llm_error end,
    twitch_channel  = case when patch ? 'twitch_channel' then patch->>'twitch_channel' else twitch_channel end,
    vote_seconds    = case when patch ? 'vote_seconds' then (patch->>'vote_seconds')::integer else vote_seconds end,
    grace_seconds   = case when patch ? 'grace_seconds' then (patch->>'grace_seconds')::integer else grace_seconds end,
    round           = case when patch ? 'round' then (patch->>'round')::integer else round end,
    round_ends_at   = case when patch ? 'round_ends_at' then (patch->>'round_ends_at')::timestamptz else round_ends_at end,
    last_chosen     = case when patch ? 'last_chosen' then patch->>'last_chosen' else last_chosen end,
    last_chosen_votes = case when patch ? 'last_chosen_votes' then (patch->>'last_chosen_votes')::integer else last_chosen_votes end,
    round_allowed   = case when patch ? 'round_allowed' then
                        case when jsonb_typeof(patch->'round_allowed') = 'array'
                             then array(select jsonb_array_elements_text(patch->'round_allowed')) else null end
                      else round_allowed end,
    auto_next_seconds = case when patch ? 'auto_next_seconds' then (patch->>'auto_next_seconds')::integer else auto_next_seconds end,
    model_mode      = case when patch ? 'model_mode' then patch->>'model_mode' else model_mode end,
    model_pool      = case when patch ? 'model_pool' then
                        case when jsonb_typeof(patch->'model_pool') = 'array'
                             then array(select jsonb_array_elements_text(patch->'model_pool')) else null end
                      else model_pool end,
    next_at         = case when patch ? 'next_at' then (patch->>'next_at')::timestamptz else next_at end,
    next_models     = case when patch ? 'next_models' then
                        case when jsonb_typeof(patch->'next_models') = 'array'
                             then array(select jsonb_array_elements_text(patch->'next_models')) else null end
                      else next_models end,
    next_game_id    = case when patch ? 'next_game_id' then patch->>'next_game_id' else next_game_id end,
    version = version + 1,
    updated_at = now()
  where id = game_id and version = expected_version
  returning * into g;
  return g;
end $$;
