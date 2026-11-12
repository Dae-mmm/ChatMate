# ChatMate

Scacchi contro gli LLM e con gli amici: una scacchiera online da giocare via link, con un endpoint testuale a cui qualsiasi LLM può collegarsi per giocare.

- Regole complete: arrocco, en passant, promozione, scacco matto, stallo, triplice ripetizione, regola delle 50 mosse, materiale insufficiente, abbandono e patta per accordo.
- Nessuna dipendenza: HTML/CSS/JS nel browser, funzioni Node su Vercel, Postgres su Supabase.
- Il motore delle regole (`lib/chess.js`) è lo stesso nel browser e sul server, ed è verificato con i test perft standard.

## Struttura

```
index.html, app.js, style.css   interfaccia (lobby + scacchiera)
lib/chess.js                    regole degli scacchi (mosse legali, SAN, fine partita)
lib/view.js                     stato di gioco e prompt per gli LLM
lib/actions.js                  mosse, abbandono, patta, long-poll
lib/store.js                    accesso a Supabase via RPC
api/games.js                    POST: crea una partita
api/game.js                     GET stato / POST azioni dei giocatori umani
api/llm.js                      endpoint testuale per gli LLM
supabase/schema.sql             schema del database
```

## Come gioca un LLM

Quando crei una partita "contro un LLM" ottieni un indirizzo personale per l'LLM:

```
GET https://<sito>/api/llm?game=<ID>&token=<TOKEN>
```

Quando è il suo turno risponde con un testo così:

```
CHESS GAME ab12cd34 - you play Black.
Opponent (White) moved: e4
Move history: 1. e4
Position (FEN): ...
Board (uppercase = White, lowercase = Black, your side at the bottom):
...
Your possible moves (20): a6, a5, b6, ..., Nf6

Use your reasoning to choose ONE move only among the ones available, then answer with that move only, ...
To play it: GET https://<sito>/api/llm?game=<ID>&token=<TOKEN>&move=<YOUR_MOVE>&wait=25
```

- `&move=Nf6` gioca la mossa. Accetta SAN (`Nf6`, `exd5`, `O-O`, `e8=Q`), UCI (`g8f6`) e risposte "sporche" (`Gioco **Nf6**`).
- `&wait=25` attende fino a 25 secondi che tocchi di nuovo all'LLM, così un agente può giocare in loop.
- `move=draw` propone o accetta la patta, `move=resign` abbandona.
- `POST` con body testo (`Nf6`) o JSON (`{"move":"Nf6"}`) funziona allo stesso modo.
- `&format=json` restituisce `{status, notice, legal, text}`.

Una mossa illegale riceve `ERROR: ...` seguito di nuovo dalla lista delle mosse possibili.

Per gli LLM in chat senza accesso al web, la pagina ha una modalità manuale: copi il prompt, lo incolli nella chat e poi incolli la risposta.

## Installazione

1. **Supabase**: crea un progetto, esegui `supabase/schema.sql` e salva l'hash del segreto (vedi commento in cima al file).
2. **Vercel**: importa questo repository (framework: *Other*, nessun comando di build) e imposta le variabili di `.env.example`.
3. Ogni push su `main` pubblica il sito.

## Sviluppo locale

Le funzioni in `api/` usano la firma Node di Vercel (`req.query`, `req.body`, `res.status().json()`), quindi `vercel dev` le esegue così come sono.
