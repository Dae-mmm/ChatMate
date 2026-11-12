# ChatMate

Scacchi contro gli LLM e con gli amici: una scacchiera online da giocare via link, con un endpoint testuale a cui qualsiasi LLM può collegarsi per giocare.

- Regole complete: arrocco, en passant, promozione, scacco matto, stallo, triplice ripetizione, regola delle 50 mosse, materiale insufficiente, abbandono e patta per accordo.
- Account con email e password: colleghi la tua chiave OpenRouter e l'LLM gioca da solo, oppure giochi in modalità copia e incolla.
- Livelli degli account (utente, streamer, admin) e pannello admin per cercare gli account, cambiarne il livello ed eliminare le partite vecchie.
- Nessuna dipendenza: HTML/CSS/JS nel browser, funzioni Node su Vercel, Postgres su Supabase.
- Il motore delle regole (`lib/chess.js`) è lo stesso nel browser e sul server, ed è verificato con i test perft standard.

## Struttura

```
index.html, app.js, style.css   interfaccia (lobby + scacchiera)
lib/chess.js                    regole degli scacchi (mosse legali, SAN, fine partita)
lib/view.js                     stato di gioco e prompt per gli LLM
lib/actions.js                  mosse, abbandono, patta, long-poll
lib/store.js                    accesso a Supabase via RPC
lib/auth.js                     verifica utente (Supabase Auth) e cifratura delle chiavi
lib/openrouter.js               catalogo modelli, stima costi, chiamate a OpenRouter
lib/llmturn.js                  turno automatico dell'LLM (con tentativi e ripiego manuale)
api/config.js                   configurazione pubblica per il login nel browser
api/account.js                  profilo, chiave OpenRouter, modello predefinito, partite
api/models.js                   lista curata dei modelli con stima dei costi
api/admin.js                    pannello admin: account, livelli, partite
api/live.js                     modalità Twitch: stato della live, voti, avanzamento dei turni
lib/live.js                     turni di voto, cuscinetto, spareggi, mossa più votata
lib/vote.js                     riconoscimento dei voti in chat (condiviso con l'overlay)
overlay.html, overlay.js, .css  overlay 16:9 per OBS (legge la chat Twitch e mostra i voti)
api/games.js                    POST: crea una partita
api/game.js                     GET stato / POST azioni dei giocatori
api/llm-turn.js                 fa giocare l'LLM via OpenRouter
api/llm.js                      endpoint testuale per gli LLM esterni
supabase/migrations/            migration del database, in ordine (vedi supabase/README.md)
```

## Tre modi di far giocare un LLM

1. **Da solo, via OpenRouter**: dall'account colleghi la tua chiave (salvata cifrata con AES-256-GCM) e scegli un modello. A ogni tua mossa il server manda il prompt al modello. Se la risposta non è una mossa legale, ritenta fino a 3 volte; dopo, passa alla modalità copia e incolla.
2. **Copia e incolla**: per ogni mossa la pagina mostra il prompt da copiare nella chat del tuo LLM. La sua risposta la scrivi (anche incollandola tutta) o la scegli dal menu a tendina delle mosse legali.
3. **Via API**: un agente o uno script apre l'endpoint testuale qui sotto.

### Stima dei costi

La lista dei modelli mostra una stima per mossa e per partita, calcolata dai prezzi di OpenRouter con queste ipotesi (in `lib/openrouter.js`, `ESTIMATE`):

- ~500 token in ingresso per mossa (misurati sui prompt reali: da ~800 caratteri in apertura a ~1.400 alla mossa 60; a centro partita le mosse legali sono circa 30-35);
- ~150 token in uscita per i modelli normali, ~2.000 per quelli con ragionamento;
- +10% per i tentativi dopo una mossa non valida;
- 45-60 mosse dell'LLM per partita.

## Modalità Twitch

Riservata agli account **streamer** e **admin**, con una chiave OpenRouter collegata. La chat di un canale Twitch gioca contro un LLM votando le mosse.

- **Come si vota**: in chat si scrive solo la mossa, esattamente in notazione inglese (`Nf6`, `exd5`, `O-O`). Le maiuscole contano (`Bxc3` è l'alfiere, `bxc3` il pedone). Sono tollerati `+`/`#` finali, `0-0` e la promozione senza `=` (`e8Q`). Ogni spettatore ha un voto per turno e vale l'ultimo che scrive.
- **Turno**: timer di voto (10-300 s, predefinito 30) e poi un cuscinetto (0-20 s, predefinito 4) per i voti in ritardo dovuti alla latenza dello stream.
- **Chiusura del turno**: se non ci sono voti il timer riparte. Se in testa c'è una parità, si fa uno spareggio solo tra le mosse a pari merito. Altrimenti si gioca la mossa più votata e risponde l'LLM.
- **Overlay**: `overlay.html?key=<chiave>` (con `&bg=transparent` per lo sfondo trasparente) va aggiunto in OBS come Browser Source 1920×1080. L'indirizzo è fisso per lo streamer e mostra sempre la sua ultima partita Twitch. L'overlay legge la chat in sola lettura (IRC anonimo, senza login) e manda i voti al sito, che li ricontrolla.
- **Ciclo automatico**: a fine partita parte un conto alla rovescia (secondi regolabili, 0 = spento) e poi una nuova partita, con la chat che cambia colore. Il modello può essere sempre lo stesso, estratto a caso tra i modelli in gara (2-5, evitando di ripetere l'ultimo) o votato dalla chat scrivendo il numero. In parità c'è lo spareggio; se nessuno vota, il modello viene estratto a caso.
- **Pannello dello streamer**: nella pagina della partita trovi il link dell'overlay, le impostazioni, un voto di prova per i test e "Nuova partita".

## Endpoint per LLM esterni

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

1. **Supabase**: crea un progetto e segui `supabase/README.md` (migration, segreto del server, URL per le email di conferma).
2. **Vercel**: importa questo repository (framework: *Other*, nessun comando di build) e imposta le variabili di `.env.example`.
3. Ogni push su `main` pubblica il sito.

## Sviluppo locale

Le funzioni in `api/` usano la firma Node di Vercel (`req.query`, `req.body`, `res.status().json()`), quindi `vercel dev` le esegue così come sono.
