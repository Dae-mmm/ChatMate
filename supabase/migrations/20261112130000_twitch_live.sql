-- 4) Modalità Twitch: la chat vota la mossa contro l'LLM.
--    Una partita "twitch" ha un canale, i tempi del turno (voto + cuscinetto) e un contatore di turni.
--    I voti stanno in una tabella a parte: un voto per spettatore per turno (vale l'ultimo).
--    round_allowed: se non è null, nel turno valgono solo queste mosse (spareggio).

alter table public.games
  add column mode text not null default 'normal' check (mode in ('normal', 'twitch')),
  add column live_key text,
  add column twitch_channel text,
  add column vote_seconds integer,
  add column grace_seconds integer,
  add column round integer not null default 0,
  add column round_ends_at timestamptz,
  add column last_chosen text,
  add column last_chosen_votes integer,
  add column round_allowed text[];

create table public.votes (
  game_id text not null references public.games(id) on delete cascade,
  round integer not null,
  voter text not null,
  move text not null,
  voted_at timestamptz not null default now(),
  primary key (game_id, round, voter)
);
alter table public.votes enable row level security;
revoke all on table public.votes from anon, authenticated;

create or replace function public.chess_create(secret text, game jsonb) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  perform public._chess_auth(secret);
  insert into public.games (id, white_kind, black_kind, white_token, black_token, white_name, black_name, owner_id, llm_model,
                            mode, live_key, twitch_channel, vote_seconds, grace_seconds)
  values (game->>'id', coalesce(game->>'white_kind','human'), coalesce(game->>'black_kind','human'),
          game->>'white_token', game->>'black_token', game->>'white_name', game->>'black_name',
          nullif(game->>'owner_id','')::uuid, game->>'llm_model',
          coalesce(game->>'mode', 'normal'), game->>'live_key', game->>'twitch_channel',
          (game->>'vote_seconds')::integer, (game->>'grace_seconds')::integer)
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
    version = version + 1,
    updated_at = now()
  where id = game_id and version = expected_version
  returning * into g;
  return g;
end $$;

-- Registra (o aggiorna) i voti di un turno: [{ "voter": "...", "move": "Nf6" }, ...]
create or replace function public.chess_vote_add(secret text, game_id text, rnd integer, votes jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public._chess_auth(secret);
  insert into public.votes (game_id, round, voter, move)
  select chess_vote_add.game_id, rnd, left(x.voter, 64), left(x.move, 12)
  from jsonb_to_recordset(votes) as x(voter text, move text)
  where x.voter is not null and x.move is not null
  on conflict on constraint votes_pkey do update set move = excluded.move, voted_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Conteggio di un turno: mossa, voti, primo voto (per gli spareggi)
create or replace function public.chess_vote_tally(secret text, game_id text, rnd integer)
returns table (move text, votes bigint, first_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  return query
    select v.move, count(*), min(v.voted_at)
    from public.votes v
    where v.game_id = chess_vote_tally.game_id and v.round = rnd
    group by v.move
    order by count(*) desc, min(v.voted_at) asc;
end $$;

grant execute on function public.chess_create(text, jsonb), public.chess_update(text, text, integer, jsonb),
  public.chess_vote_add(text, text, integer, jsonb), public.chess_vote_tally(text, text, integer) to anon;
