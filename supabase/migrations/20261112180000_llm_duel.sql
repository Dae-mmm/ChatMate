-- 9) Partite LLM contro LLM (solo admin): entrambi i lati sono 'llm'.
--    llm_model è il modello del Bianco, llm_model_b quello del Nero (null nelle altre partite).

alter table public.games add column llm_model_b text;

create or replace function public.chess_create(secret text, game jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  insert into public.games (id, white_kind, black_kind, white_token, black_token, white_name, black_name, owner_id, llm_model,
                            mode, live_key, twitch_channel, vote_seconds, grace_seconds,
                            auto_next_seconds, model_mode, model_pool, llm_model_b)
  values (game->>'id', coalesce(game->>'white_kind','human'), coalesce(game->>'black_kind','human'),
          game->>'white_token', game->>'black_token', game->>'white_name', game->>'black_name',
          nullif(game->>'owner_id','')::uuid, game->>'llm_model',
          coalesce(game->>'mode', 'normal'), game->>'live_key', game->>'twitch_channel',
          (game->>'vote_seconds')::integer, (game->>'grace_seconds')::integer,
          (game->>'auto_next_seconds')::integer, coalesce(game->>'model_mode', 'fixed'),
          case when jsonb_typeof(game->'model_pool') = 'array' then array(select jsonb_array_elements_text(game->'model_pool')) else null end,
          game->>'llm_model_b')
  returning * into g;
  return g;
end $$;
