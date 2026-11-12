-- 11) Diario delle mosse dell'LLM: per ogni mossa giocata da un modello si salvano risposta, ragionamento,
--     modello, spesa e numero di tentativi, così si può ripercorrere cosa ha "pensato" in quel momento.
--     Le righe spariscono insieme alla partita.

create table public.llm_moves (
  game_id text not null references public.games(id) on delete cascade,
  ply integer not null,              -- indice della mossa nella partita (0 = prima mossa del Bianco)
  color text not null check (color in ('w', 'b')),
  model text,
  san text not null,
  reply text,
  reasoning text,
  cost numeric not null default 0,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (game_id, ply)
);
alter table public.llm_moves enable row level security;
revoke all on table public.llm_moves from anon, authenticated;

create or replace function public.chess_llm_move_add(secret text, entry jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  insert into public.llm_moves (game_id, ply, color, model, san, reply, reasoning, cost, attempts)
  values (entry->>'game_id', (entry->>'ply')::integer, entry->>'color', entry->>'model', entry->>'san',
          entry->>'reply', entry->>'reasoning', coalesce((entry->>'cost')::numeric, 0), coalesce((entry->>'attempts')::integer, 1))
  on conflict (game_id, ply) do update set
    color = excluded.color, model = excluded.model, san = excluded.san, reply = excluded.reply,
    reasoning = excluded.reasoning, cost = excluded.cost, attempts = excluded.attempts, created_at = now();
end $$;

create or replace function public.chess_llm_moves(secret text, game_id text) returns setof public.llm_moves
language plpgsql security definer set search_path = public as $$
begin
  perform public._chess_auth(secret);
  return query select * from public.llm_moves m where m.game_id = chess_llm_moves.game_id order by m.ply;
end $$;

grant execute on function public.chess_llm_move_add(text, jsonb), public.chess_llm_moves(text, text) to anon;
