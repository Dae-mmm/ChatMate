# Database (Supabase)

Le migration in `migrations/` vanno applicate **in ordine** (il nome inizia con data e ora):

| File | Cosa fa |
| --- | --- |
| `20261112080000_chess_games.sql` | Tabella `games`, tabella `app_config` e funzioni `chess_get/create/update` protette dal segreto del server |
| `20261112100000_accounts_and_llm.sql` | Account: tabella `profiles` (chiave OpenRouter cifrata, modello predefinito), partite collegate al proprietario, stato del turno dell'LLM |
| `20261112120000_roles_and_admin.sql` | Livelli degli account (`user`, `streamer`, `admin`) e funzioni del pannello admin (ricerca account, cambio livello, elenco ed eliminazione partite) |
| `20261112130000_twitch_live.sql` | Modalità Twitch: canale e tempi del turno sulle partite, tabella `votes` (un voto per spettatore per turno), conteggio e spareggi |
| `20261112140000_live_key.sql` | Chiave dell'overlay per streamer: l'indirizzo in OBS resta fisso e mostra l'ultima partita Twitch |
| `20261112150000_auto_next.sql` | Ciclo automatico delle live: conto alla rovescia a fine partita, modello fisso / casuale / votato, modelli in gara |
| `20261112160000_llm_reasoning.sql` | Ragionamento dell'LLM salvato a parte rispetto alla risposta (colonna `llm_last_reasoning`) |
| `20261112170000_reasoning_setting.sql` | Spunta dell'account per far ragionare i modelli (colonna `llm_reasoning`, attiva di default) |
| `20261112180000_llm_duel.sql` | Partite LLM contro LLM (solo admin): modello del Nero in `llm_model_b` |
| `20261112190000_llm_cost.sql` | Spesa reale dei modelli per partita (`llm_cost_w`, `llm_cost_b`, da usage.cost di OpenRouter) |
| `20261112200000_llm_move_log.sql` | Diario delle mosse dell'LLM (tabella `llm_moves`: risposta, ragionamento, modello, spesa per mossa) |
| `20261113010000_show_reasoning.sql` | Live Twitch: ragionamento dell'LLM sull'overlay sì/no (`show_reasoning`) |

Ogni nuova modifica al database va aggiunta qui come nuovo file, mai modificando quelli esistenti.

## Spostare il progetto su un altro account Supabase

1. Crea il nuovo progetto Supabase.
2. Applica le migration, in uno di questi modi:
   - con la CLI: `supabase link --project-ref <ref>` e poi `supabase db push`;
   - a mano: incolla i file, uno alla volta e in ordine, nell'SQL Editor.
3. Salva l'hash del segreto del server (lo stesso valore di `CHESS_SERVER_SECRET` su Vercel; puoi generarne uno nuovo):
   ```sql
   insert into public.app_config(key, value)
   values ('server_secret_sha256', encode(sha256(convert_to('<IL_TUO_SEGRETO>', 'UTF8')), 'hex'));
   ```
4. In **Authentication → URL Configuration** imposta *Site URL* sull'indirizzo del sito (es. `https://chatmate-chess.vercel.app`) e aggiungilo anche ai *Redirect URLs*: serve per i link di conferma email e di recupero password.
5. Registrati sul sito e rendi admin il tuo account (dall'SQL Editor):
   ```sql
   insert into public.profiles (user_id, role)
   select id, 'admin' from auth.users where email = '<la-tua-email>'
   on conflict (user_id) do update set role = 'admin';
   ```
   Gli altri livelli poi li gestisci dal pannello admin del sito (`/?p=admin`).
6. Su Vercel aggiorna `SUPABASE_URL` e `SUPABASE_ANON_KEY` con i valori del nuovo progetto e ripubblica.

`KEY_ENC_SECRET` (la chiave che cifra le chiavi OpenRouter) non dipende da Supabase. Se però la cambi, le chiavi già salvate non si possono più leggere e gli utenti devono reinserirle.

Le partite e gli account esistenti non vengono copiati dalle migration. Se ti servono, esporta e reimporta i dati delle tabelle `games`, `profiles` e degli utenti di `auth.users`.
