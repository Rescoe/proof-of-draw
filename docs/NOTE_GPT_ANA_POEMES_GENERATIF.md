# Note de passation — poèmes et œuvres génératives d'ANA vers les écrans PoD

Rédigée le 01/10/2026 par Claude pour GPT (travail en concertation). **Aucun code n'a été écrit pour ce chantier.**
Le porteur décide ; rien ne se commite, se pousse ni se déploie sans son accord.

## 1. Objectif

Faire arriver sur les écrans PoD qui ont activé « réception des agents IA » (`acceptsAnaArt`) :
1. les **poèmes** d'ANA (`artForm` : `haiku`, `sonnet`, `poeme`, `prose`, `manifeste`) ;
2. les **œuvres génératives** (`html-canvas`, `html-p5js`, `html-threejs`, `html-webgl`), sous forme de **frame capturée** (capture d'écran du rendu) ;
3. les dessins spontanés (« spontaneous work ») : déjà prévus dans le pont, jamais ingérés à ce jour (aucun approuvé ? à vérifier côté ANA).

Les **memorials** (`pixel-drawing`) fonctionnent et ne doivent pas régresser.

## 2. État vérifié (lecture seule, 01/10/2026)

- Pont actuel : ANA `GET /api/ana-art/feed` → PoD `lib/anaFeed.ts` → `lib/screenEncode.ts` → `broadcastToDevices` (diffusion live) + `createAnaBlock` (`lib/anaChain.ts`, galerie `/gallery-ana`, index Redis `chain:ana:*`).
- **Côté ANA**, `src/app/api/ana-art/feed/route.ts` ne renvoie que `artForm === "pixel-drawing" && state === "PUBLISHED"` + dessins spontanés `decision === "approved"` (lignes ~76 et ~105). Poèmes et génératifs sont exclus.
- **Côté PoD**, tout part de pixels en niveaux de gris (`pixels` base64, `canvasW × canvasH`). Rien ne reçoit du texte ni une capture.
- 7 œuvres ingérées en prod, toutes des memorials ; la dernière le 23/09/2026. Appareils opt-in : `dev_KAD6PKC4` (OLED + e-ink 2.7), `dev_VIRBQRV1` (TFT), `dev_MN67OG7R` (e-ink 2.9).
- Le `.env.local` local n'a pas `ANA_API_URL` / `ANA_ART_FEED_SECRET` : le feed ne peut pas être interrogé depuis le poste de dev, seulement vérifié via Redis.
- Étude existante côté ANA : `Agentic-Normie-Association/ETUDE_FAISABILITE_POD_ANIMATIONS_POEMES.md` (26/09). Elle date d'avant les évolutions du 30/09 (`62746a9` feed enrichi du cartel ; PoD `ac8d801` conversion inter-écrans, `518b72d` galerie une carte par œuvre).

## 3. Proposition de Claude (à discuter, non décidée)

**Poèmes d'abord** (le plus simple, sans toucher au firmware) :
- ANA : étendre le feed avec un nouvel item `kind: "poem"` portant le **texte** (+ titre, agent, `artForm`), pas des pixels.
- PoD : rendre le texte en pixels côté serveur (retour à la ligne, centrage, accents français), puis réutiliser `encodeForScreen` par écran et le même chemin `broadcastToDevices` + `createAnaBlock`. PoD a déjà une police bitmap 5×7 avec accents dans `lib/drawEngine/text.ts` (moteur pur, testé) : réutilisable pour éviter une nouvelle dépendance.
- Contrainte de format : OLED 128×64 (≈ 21 colonnes × 8 lignes en 5×7 non agrandi) ; e-ink 2.7 = 264×176 ; e-ink 2.9 = 296×128 ; TFT = 128×160. Un poème long doit être **paginé** (ou tronqué avec règle explicite) : décision à prendre.

**Génératif ensuite** :
- ANA capture une frame du rendu (HTML/JS exécuté côté ANA, jamais côté PoD) et l'expose comme `pixels` (même contrat que les memorials) ou comme image à convertir. Jamais d'exécution de code d'œuvre côté PoD ni ESP.
- L'étude du 26/09 recommande de **démarrer à 10 frames** pour d'éventuelles boucles (heap ESP8266 / BearSSL) : une seule frame fixe est le premier jalon.

## 4. Contraintes à respecter (invariants)

- `CLAUDE.md` : pas de cron (vérifications opportunistes, voir `maybeCheckAnaFeed` débouncé dans `/api/pull`), pas de websocket, pas de fetch sortant vers IP locale, serverless-safe (état dans Redis uniquement), TypeScript strict.
- Firmware ESP8266 : `/api/pull` ne renvoie jamais de pixels ; `/api/pull-frame` renvoie le binaire ; `readFull()` en boucle ; libérer/allouer les buffers autour de TLS. **Ne pas changer le firmware** pour le premier jalon.
- Un poème / une capture = une frame **par type d'écran** (`ANA_ENCODABLE_SCREENS = SCREEN_IDS`), stockée par écran, TTL 15 min (`FRAME_TTL` ; fix `246f404` : 2 h ne laissait pas le temps aux ESP).
- Le cartel (déclaration d'artiste) n'est affiché que dans la galerie, jamais envoyé aux écrans ; ne pas casser `AnaWorkMeta`.
- Redis Upstash gratuit : ~25 000 commandes/jour pour 500 000/mois. **Ne pas ajouter de SCAN ni de lectures par requête** ; voir « Quota Upstash » dans `docs/IDEES_A_PLUS_TARD.md`.
- Dédup : `chain:ana:ingested` (clé = `item.id`). Un nouvel `id` pour chaque poème ; ne pas réutiliser les ids des memorials.
- Ne pas modifier `ActionEvent` / `ReplayEvent` (moteur de dessin) : sans rapport avec ce chantier.

## 5. Dépôts et fichiers utiles

- ANA : `C:\Users\thibf\Documents\App-Rescoe\Agentic-Normie-Association` — `src/app/api/ana-art/feed/route.ts`, `src/lib/memorialArt.ts`, `src/lib/workStore.ts` (`artForm`), `src/app/api/keeper/work-lifecycle/route.ts`.
- PoD : `lib/anaFeed.ts`, `lib/screenEncode.ts`, `lib/broadcast.ts`, `lib/anaChain.ts`, `app/api/pull/route.ts`, `app/gallery-ana/*`, `lib/drawEngine/text.ts`.
- Mémoire détaillée du pont : `C:\Users\thibf\.claude\projects\C--Users-thibf-Documents-App-Rescoe-proof-of-draw\memory\project_ana_celebration_bridge.md` (peut dater de plusieurs jours : vérifier le code avant de s'y fier).

## 6. Questions ouvertes pour le porteur

1. Poèmes longs : paginer (rotation d'écran ?) ou limiter la longueur (par ex. haïku / quatrain seulement) ?
2. Un poème s'affiche-t-il sur **tous** les écrans opt-in ou selon sa forme (OLED : haïku seulement) ?
3. Génératif : une seule frame fixe pour l'instant, ou préparer une boucle de ≤ 10 frames ?
4. Fréquence maximale par écran (un poème ne doit pas écraser un memorial ou un dessin d'artiste en cours d'affichage).
5. Y a-t-il des dessins spontanés approuvés côté ANA ? (aucun ingéré à ce jour)

## 7. Comment se coordonner

- Claude a vérifié l'état côté PoD ; il **n'a pas relu le code récent d'ANA après le 30/09** au-delà des fichiers cités.
- Proposition de partage : GPT sur la partie ANA (feed + capture de frame), Claude sur la partie PoD (rendu du texte, encodage, galerie), avec un **contrat d'échange** écrit d'abord (champs de `kind: "poem"` et de la capture) avant tout code.
- Avant d'écrire : relire `git status` des deux dépôts ; le dépôt PoD contient des documents non suivis du porteur (`docs/AUDIT_PAGE_DESSIN.md`, `docs/IDEES_A_PLUS_TARD.md`, `docs/PROMPT_REFONTE_DESSIN.md`) — ne pas les supprimer.

---

## 8. Décisions du porteur (01/10/2026, après relecture) — elles remplacent les « questions ouvertes » du §6

1. **Tous les écrans doivent pouvoir tout recevoir.** Le réglage `acceptsAnaArt` (« accepter tout ce que produisent les agents IA ») couvre aussi poèmes et génératifs ; pas de filtrage par écran selon la forme.
2. **Poèmes longs : on réduit d'abord la taille** (texte condensé), puis :
3. **Écrans trop petits : réserver un cadre de 40 × 40 px à l'image du Normie qui envoie** (les Normies sont des visuels 40×40), le reste de la surface portant le texte.
   - **OLED 128×64** : cadre Normie 40×40 + zone de texte (≈ 88 px de large) avec **défilement horizontal ou vertical** du poème.
   - **TFT 128×160** : pareil, avec **défilement de haut en bas**.
   - e-ink : pas de défilement possible (rafraîchissement lent) → texte condensé/paginé ; cadre Normie facultatif selon la place.
   - ⚠ Le défilement implique **plusieurs frames** : lié à la limite mémoire de l'étude du 26/09 (démarrer à ~10 frames, OLED/TFT à mesurer). Premier jalon réaliste : **une frame fixe** avec cadre Normie + texte condensé ; défilement ensuite.
4. **Galerie « Dessins d'agent IA » (PoD `/gallery-ana`)** : le panneau Provenance doit afficher cartel, brief, vote, etc. Et **l'image du Normie auteur doit y figurer** (aujourd'hui seulement le nom et `agentTokenId`).
5. La mise en œuvre est confiée à la **concertation GPT ↔ Claude** décrite au §7.

## 9. Diagnostic à traiter en premier : le contexte de l'œuvre n'arrive pas dans la galerie

Constat (lecture seule sur la base de prod, 01/10/2026) : la galerie affiche « Le contexte de cette œuvre (cartel, brief…) n'a pas encore été récupéré ». Redis confirme : `chain:ana:meta-synced` = **0**, aucune clé `chain:ana:workmeta:*`, alors que `chain:ana:ingested` = 7. Donc `saveAnaWorkMeta` (appelé dans `checkAnaFeedNow`, `lib/anaFeed.ts`) **n'a jamais abouti** depuis le déploiement du 30/09, et aucune œuvre n'a été ingérée depuis le 23/09.

Faits : le feed d'ANA répond (401 sans secret, donc en ligne) ; ses champs enrichis existent côté code (commit ANA `62746a9`, 30/09) ; la clé de débounce `chain:ana:last-checked` est bien posée à chaque pull d'un appareil opt-in, donc `checkAnaFeedNow` est appelé.

Hypothèses (non vérifiées — **à trancher avec les logs Vercel** : chercher `[anaFeed]`) :
- `fetchAnaFeed()` retourne `[]` en silence : secret `ANA_ART_FEED_SECRET` différent entre ANA et PoD (log `ANA feed returned 401`), URL erronée, ou **timeout de 5 s** (`FETCH_TIMEOUT_MS`, risque de démarrage à froid côté ANA/Neon) ;
- ou la version déployée d'ANA n'est pas celle du commit `62746a9` ;
- ou le code de rattrapage ne se déclenche qu'avec au moins un item renvoyé (`for (const item of items)`).

À faire : (a) lire les logs, (b) rendre l'échec **visible** (compteur/clé de statut du dernier fetch : code HTTP, nombre d'items, date) plutôt que silencieux, (c) vérifier la présence des champs `cartelText` / `brief` / `voteResult` dans la réponse réelle, (d) ajouter l'image du Normie (`getNormieImageUrl(tokenId)` dans `src/lib/normiesApi.ts` côté ANA) — soit URL dans l'item du feed, soit pixels 40×40 pour les écrans.
