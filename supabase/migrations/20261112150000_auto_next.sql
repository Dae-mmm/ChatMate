-- 6) Ciclo automatico delle live: a fine partita parte un conto alla rovescia e poi una nuova partita.
--    auto_next_seconds: secondi prima della nuova partita (null/0 = spento)
--    model_mode:        'fixed' (stesso modello), 'random' (estratto tra model_pool), 'vote' (votato dalla chat)
--    model_pool:        modelli in gara (max 5)
--    next_at:           quando finisce il conto alla rovescia (sulla partita finita)
--    next_models:       opzioni del voto sul modello, nell'ordine mostrato (1..5)
--    next_game_id:      partita creata dopo questa (impedisce di crearne due)

alter table public.games
  add column auto_next_seconds integer,
  add column model_mode text not null default 'fixed' check (model_mode in ('fixed', 'random', 'vote')),
  add column model_pool text[],
  add column next_at timestamptz,
  add column next_models text[],
  add column next_game_id text;

create or replace function public.chess_create(secret text, game jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  insert into public.games (id, white_kind, black_kind, white_token, black_token, white_name, black_name, owner_id, llm_model,
                            mode, live_key, twitch_channel, vote_seconds, grace_seconds,
                            auto_next_seconds, model_mode, model_pool)
  values (game->>'id', coalesce(game->>'white_kind','human'), coalesce(game->>'black_kind','human'),
          game->>'white_token', game->>'black_token', game->>'white_name', game->>'black_name',
          nullif(game->>'owner_id','')::uuid, game->>'llm_model',
          coalesce(game->>'mode', 'normal'), game->>'live_key', game->>'twitch_channel',
          (game->>'vote_seconds')::integer, (game->>'grace_seconds')::integer,
          (game->>'auto_next_seconds')::integer, coalesce(game->>'model_mode', 'fixed'),
          case when jsonb_typeof(game->'model_pool') = 'array' then array(select jsonb_array_elements_text(game->'model_pool')) else null end)
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

grant execute on function public.chess_create(text, jsonb), public.chess_update(text, text, integer, jsonb) to anon;
