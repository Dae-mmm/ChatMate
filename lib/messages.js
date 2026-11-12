// Messaggi del server in en, it, es, fr, de, pt. La lingua arriva dall'header X-Lang (o Accept-Language).
export const MESSAGES = {
  method: { en: 'Method not allowed.', it: 'Metodo non supportato.', es: "Método no permitido.", fr: "Méthode non autorisée.", de: "Methode nicht erlaubt.", pt: "Método não permitido." },
  server: { en: 'Server error, please try again.', it: 'Errore del server, riprova.', es: "Error del servidor, vuelve a intentarlo.", fr: "Erreur du serveur, réessayez.", de: "Serverfehler, bitte erneut versuchen.", pt: "Erro do servidor, tente de novo." },
  unknown_action: { en: 'Unknown action.', it: 'Azione sconosciuta.', es: "Acción desconocida.", fr: "Action inconnue.", de: "Unbekannte Aktion.", pt: "Ação desconhecida." },
  login_required: { en: 'Log in to continue.', it: 'Accedi per continuare.', es: "Inicia sesión para continuar.", fr: "Connectez-vous pour continuer.", de: "Melde dich an, um fortzufahren.", pt: "Entre para continuar." },
  not_found: { en: 'Game not found.', it: 'Partita non trovata.', es: "Partida no encontrada.", fr: "Partie introuvable.", de: "Partie nicht gefunden.", pt: "Partida não encontrada." },
  not_found_deleted: { en: 'Game not found (it may have been deleted).', it: 'Partita non trovata (forse è stata eliminata).', es: "Partida no encontrada (quizá se eliminó).", fr: "Partie introuvable (elle a peut-être été supprimée).", de: "Partie nicht gefunden (vielleicht wurde sie gelöscht).", pt: "Partida não encontrada (talvez tenha sido excluída)." },
  not_player: { en: "You're not a player in this game.", it: 'Non sei un giocatore di questa partita.', es: "No juegas en esta partida.", fr: "Vous ne jouez pas dans cette partie.", de: "Du spielst in dieser Partie nicht mit.", pt: "Você não joga nesta partida." },
  no_llm_opponent: { en: "There's no LLM opponent in this game.", it: "In questa partita non c'è un LLM avversario.", es: "En esta partida no hay un LLM rival.", fr: "Il n'y a pas de LLM adversaire dans cette partie.", de: "In dieser Partie gibt es keinen LLM-Gegner.", pt: "Nesta partida não há um LLM adversário." },
  twitch_moves_by_chat: { en: 'In a live game the chat decides the moves.', it: 'In una live le mosse le decide la chat.', es: "En un directo las jugadas las decide el chat.", fr: "En live, c'est le chat qui décide des coups.", de: "In einem Livestream entscheidet der Chat über die Züge.", pt: "Numa live quem decide os lances é o chat." },
  game_over: { en: 'The game is over.', it: 'La partita è finita.', es: "La partida ha terminado.", fr: "La partie est terminée.", de: "Die Partie ist beendet.", pt: "A partida terminou." },
  not_your_turn: { en: "It's not your turn.", it: 'Non è il tuo turno.', es: "No es tu turno.", fr: "Ce n'est pas votre tour.", de: "Du bist nicht am Zug.", pt: "Não é a sua vez." },
  illegal_move: { en: 'Illegal move: "{move}"', it: 'Mossa non legale: "{move}"', es: "Jugada ilegal: \"{move}\"", fr: "Coup illégal : « {move} »", de: "Illegaler Zug: „{move}“", pt: "Lance ilegal: \"{move}\"" },
  no_draw_offer: { en: 'There is no draw offer to accept.', it: 'Nessuna proposta di patta da accettare.', es: "No hay ninguna oferta de tablas que aceptar.", fr: "Il n'y a pas de proposition de nulle à accepter.", de: "Es gibt kein Remisangebot zum Annehmen.", pt: "Não há proposta de empate para aceitar." },
  conflict: { en: 'The game changed at the same time, please try again.', it: 'Conflitto di aggiornamento, riprova.', es: "La partida cambió a la vez, vuelve a intentarlo.", fr: "La partie a changé au même moment, réessayez.", de: "Die Partie hat sich gleichzeitig geändert, bitte erneut versuchen.", pt: "A partida mudou ao mesmo tempo, tente de novo." },
  // Twitch
  overlay_key_invalid: { en: 'Invalid overlay key.', it: 'Chiave overlay non valida.', es: "Clave del overlay no válida.", fr: "Clé d'overlay invalide.", de: "Ungültiger Overlay-Schlüssel.", pt: "Chave do overlay inválida." },
  no_twitch_game: { en: 'No Twitch game for this key: create one on the site.', it: 'Nessuna partita Twitch per questa chiave: creane una dal sito.', es: "No hay partida de Twitch para esta clave: crea una en el sitio.", fr: "Aucune partie Twitch pour cette clé : créez-en une sur le site.", de: "Keine Twitch-Partie für diesen Schlüssel: Erstelle eine auf der Website.", pt: "Nenhuma partida da Twitch para esta chave: crie uma no site." },
  only_streamer_settings: { en: 'Only the streamer can change the settings.', it: 'Solo lo streamer può cambiare le impostazioni.', es: "Solo el streamer puede cambiar los ajustes.", fr: "Seul le streamer peut modifier les réglages.", de: "Nur der Streamer kann die Einstellungen ändern.", pt: "Só o streamer pode mudar as configurações." },
  channel_invalid: { en: 'Invalid Twitch channel name.', it: 'Nome del canale Twitch non valido.', es: "Nombre de canal de Twitch no válido.", fr: "Nom de chaîne Twitch invalide.", de: "Ungültiger Twitch-Kanalname.", pt: "Nome de canal da Twitch inválido." },
  channel_required: { en: 'Enter the Twitch channel name (e.g. mychannel).', it: 'Scrivi il nome del canale Twitch (es. ilmiocanale).', es: "Escribe el nombre del canal de Twitch (p. ej. micanal).", fr: "Saisissez le nom de la chaîne Twitch (ex. machaine).", de: "Gib den Namen des Twitch-Kanals ein (z. B. meinkanal).", pt: "Escreva o nome do canal da Twitch (ex. meucanal)." },
  model_mode_invalid: { en: 'Invalid model selection mode.', it: 'Modalità di scelta del modello non valida.', es: "Modo de elección del modelo no válido.", fr: "Mode de choix du modèle invalide.", de: "Ungültiger Modus für die Modellwahl.", pt: "Modo de escolha do modelo inválido." },
  pool_min2: { en: 'Random or voted models need at least 2 models in the pool.', it: 'Per il modello casuale o votato servono almeno 2 modelli in gara.', es: "Los modelos al azar o votados necesitan al menos 2 modelos en juego.", fr: "Les modèles au hasard ou votés demandent au moins 2 modèles en lice.", de: "Zufällige oder gewählte Modelle brauchen mindestens 2 Modelle im Rennen.", pt: "Modelos aleatórios ou votados precisam de pelo menos 2 modelos na disputa." },
  game_changed_retry: { en: 'The game just changed, please try again.', it: 'La partita è appena cambiata, riprova.', es: "La partida acaba de cambiar, vuelve a intentarlo.", fr: "La partie vient de changer, réessayez.", de: "Die Partie hat sich gerade geändert, bitte erneut versuchen.", pt: "A partida acabou de mudar, tente de novo." },
  login_live: { en: 'Log in to create a live game.', it: 'Accedi per creare una live.', es: "Inicia sesión para crear un directo.", fr: "Connectez-vous pour créer un live.", de: "Melde dich an, um einen Livestream zu erstellen.", pt: "Entre para criar uma live." },
  twitch_streamer_only: { en: 'Twitch mode is for streamer accounts.', it: 'La modalità Twitch è riservata agli account streamer.', es: "El modo Twitch es para cuentas de streamer.", fr: "Le mode Twitch est réservé aux comptes streamer.", de: "Der Twitch-Modus ist für Streamer-Konten.", pt: "O modo Twitch é para contas de streamer." },
  twitch_needs_key: { en: 'Twitch mode needs an OpenRouter key on your account.', it: 'Per la modalità Twitch serve una chiave OpenRouter collegata al tuo account.', es: "El modo Twitch necesita una clave de OpenRouter en tu cuenta.", fr: "Le mode Twitch nécessite une clé OpenRouter sur votre compte.", de: "Der Twitch-Modus braucht einen OpenRouter-Schlüssel in deinem Konto.", pt: "O modo Twitch precisa de uma chave do OpenRouter na sua conta." },
  twitch_pick_model: { en: 'Pick the model that will play against the chat.', it: 'Scegli il modello che giocherà contro la chat.', es: "Elige el modelo que jugará contra el chat.", fr: "Choisissez le modèle qui jouera contre le chat.", de: "Wähle das Modell, das gegen den Chat spielt.", pt: "Escolha o modelo que vai jogar contra o chat." },
  voting_closed: { en: 'Voting is closed.', it: 'Votazione chiusa.', es: "La votación está cerrada.", fr: "Le vote est clos.", de: "Die Abstimmung ist beendet.", pt: "A votação está encerrada." },
  no_vote_open: { en: 'No vote in progress.', it: 'Nessun voto in corso.', es: "No hay ninguna votación en curso.", fr: "Aucun vote en cours.", de: "Keine Abstimmung im Gange.", pt: "Nenhuma votação em andamento." },
  duel_needs_key: { en: "LLM vs LLM games need an OpenRouter key on your account.", it: "Per le partite LLM contro LLM serve una chiave OpenRouter collegata al tuo account.", es: "Las partidas LLM contra LLM necesitan una clave de OpenRouter en tu cuenta.", fr: "Les parties LLM contre LLM nécessitent une clé OpenRouter sur votre compte.", de: "Partien LLM gegen LLM brauchen einen OpenRouter-Schlüssel in deinem Konto.", pt: "Partidas LLM contra LLM precisam de uma chave do OpenRouter na sua conta." },
  duel_pick_models: { en: "Pick a model for White and one for Black.", it: "Scegli un modello per il Bianco e uno per il Nero.", es: "Elige un modelo para las blancas y otro para las negras.", fr: "Choisissez un modèle pour les Blancs et un pour les Noirs.", de: "Wähle ein Modell für Weiß und eines für Schwarz.", pt: "Escolha um modelo para as brancas e outro para as pretas." },
  // Account e OpenRouter
  key_prefix: { en: 'OpenRouter keys start with "sk-or-".', it: 'Le chiavi OpenRouter iniziano con "sk-or-".', es: "Las claves de OpenRouter empiezan por \"sk-or-\".", fr: "Les clés OpenRouter commencent par « sk-or- ».", de: "OpenRouter-Schlüssel beginnen mit „sk-or-“.", pt: "As chaves do OpenRouter começam com \"sk-or-\"." },
  key_invalid: { en: 'Invalid OpenRouter key.', it: 'Chiave OpenRouter non valida.', es: "Clave de OpenRouter no válida.", fr: "Clé OpenRouter invalide.", de: "Ungültiger OpenRouter-Schlüssel.", pt: "Chave do OpenRouter inválida." },
  openrouter_down: { en: "OpenRouter isn't responding ({status}), please try again.", it: 'OpenRouter non risponde ({status}), riprova.', es: "OpenRouter no responde ({status}), vuelve a intentarlo.", fr: "OpenRouter ne répond pas ({status}), réessayez.", de: "OpenRouter antwortet nicht ({status}), bitte erneut versuchen.", pt: "O OpenRouter não responde ({status}), tente de novo." },
  model_id_invalid: { en: 'Invalid model ID (format: provider/model).', it: 'ID modello non valido (formato: casa/modello).', es: "ID de modelo no válido (formato: proveedor/modelo).", fr: "ID de modèle invalide (format : fournisseur/modèle).", de: "Ungültige Modell-ID (Format: anbieter/modell).", pt: "ID de modelo inválido (formato: provedor/modelo)." },
  models_unavailable: { en: "OpenRouter's catalogue is unavailable: you can type the model ID by hand.", it: "Catalogo OpenRouter non disponibile, puoi scrivere l'ID del modello a mano.", es: "El catálogo de OpenRouter no está disponible: puedes escribir el ID del modelo a mano.", fr: "Le catalogue OpenRouter est indisponible : vous pouvez saisir l'ID du modèle à la main.", de: "Der OpenRouter-Katalog ist nicht verfügbar: Du kannst die Modell-ID von Hand eingeben.", pt: "O catálogo do OpenRouter não está disponível: você pode digitar o ID do modelo à mão." },
  // Admin
  admin_required: { en: 'This needs an admin account.', it: 'Serve un account admin.', es: "Hace falta una cuenta admin.", fr: "Il faut un compte admin.", de: "Dafür ist ein Admin-Konto nötig.", pt: "É preciso uma conta admin." },
  role_invalid: { en: 'Invalid level.', it: 'Livello non valido.', es: "Nivel no válido.", fr: "Niveau invalide.", de: "Ungültige Stufe.", pt: "Nível inválido." },
  own_role: { en: "You can't change your own level here.", it: 'Non puoi cambiare il tuo livello da qui.', es: "Aquí no puedes cambiar tu propio nivel.", fr: "Vous ne pouvez pas changer votre propre niveau ici.", de: "Du kannst deine eigene Stufe hier nicht ändern.", pt: "Você não pode mudar o seu próprio nível aqui." },
  user_invalid: { en: 'Invalid user.', it: 'Utente non valido.', es: "Usuario no válido.", fr: "Utilisateur invalide.", de: "Ungültiger Nutzer.", pt: "Usuário inválido." },
  no_games_selected: { en: 'No games selected.', it: 'Nessuna partita selezionata.', es: "No hay partidas seleccionadas.", fr: "Aucune partie sélectionnée.", de: "Keine Partien ausgewählt.", pt: "Nenhuma partida selecionada." },
  min_one_day: { en: 'Enter at least 1 day.', it: 'Indica almeno 1 giorno.', es: "Indica al menos 1 día.", fr: "Indiquez au moins 1 jour.", de: "Gib mindestens 1 Tag an.", pt: "Indique pelo menos 1 dia." },
};

export const LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt'];

export function langOf(req) {
  const h = String(req?.headers?.['x-lang'] || req?.headers?.['accept-language'] || '').toLowerCase().slice(0, 2);
  return LANGS.includes(h) ? h : 'en';
}

export const msg = (lang, key, vars = {}) =>
  String(MESSAGES[key]?.[lang] || MESSAGES[key]?.en || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// Errore con codice: il testo viene scelto nella lingua di chi ha fatto la richiesta
export class AppError extends Error {
  constructor(key, vars = {}) { super(key); this.key = key; this.vars = vars; }
}

// Risposta di errore uniforme per le API
export function sendError(res, req, e, status = 400) {
  const lang = langOf(req);
  if (e instanceof AppError) return res.status(e.status && e.status >= 400 && e.status < 500 ? 400 : status).json({ error: msg(lang, e.key, e.vars), code: e.key });
  console.error(e);
  return res.status(500).json({ error: msg(lang, 'server'), code: 'server' });
}
