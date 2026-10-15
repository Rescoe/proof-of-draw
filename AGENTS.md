# AGENTS.md

> **État courant (vérifié le 15/10/2026) : lire d'abord `lib/projectStatus.ts` (source unique des faits publics), `docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md`, `docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md` puis `docs/RESTE_A_FAIRE_2026_10_14.md`.** Les sections ci-dessous qui portent une date antérieure sont HISTORIQUES : elles décrivent la V1 du 16/05/2026 et ne reflètent plus l'état du projet. Les consignes de prudence (invariants mémoire, sécurité, rendu) restent en vigueur.

## Mission

Le projet `proof-of-draw` est une application Next.js + firmware ESP8266 pour dessiner depuis le web et afficher les frames sur des écrans e-ink / OLED connectés à des ESP.

**Ne pas refaire l'application. Ne pas restructurer le projet. Ne pas refactoriser l'UI globalement.**

---

## Statut

**Historique (16/05/2026)** : la V1 distribuée fonctionnait sur l'e-ink 2,9″ BWR (pipeline dessin → candidat → vote ESP → bloc miné → fetch binaire → affichage ; commit de référence `43aac8f`).

**État au 15/10/2026** :
- le **vote v2 réel est opérationnel** : les appareils recalculent le contenu brut et trois métriques entières, puis signent leur vote en **Ed25519** ; le serveur vérifie réellement les signatures (mode strict) ;
- des blocs réels ont été minés par quorum multi-appareils : **#100, #101, #103 et #104** (#104 : 2 votes v2, 0 vote v1, 0 rejet) ;
- validateurs v2 observés sur la carte réelle : UNO R4 e-ink 2,9″, UNO R4 TFT 2,8″ (dont l'ACK décisif), ESP8266 e-ink 2,9″, ESP8266 multiscreen ; les autres familles sont des **qualifications matérielles restantes**, pas une absence de consensus ;
- un appareil incapable de voter en v2 **reçoit encore les œuvres** mais ne reçoit pas `pendingValidation`, ne vote pas et ne compte pas dans le quorum ;
- les animations sont encore votées en v1 ; l'OTA n'est pas généralisée ; *Proof-of-Display Duration* est une piste de recherche ;
- **modèle de confiance** : preuve applicative et cryptographique orchestrée par le serveur et les appareils ; clés en EEPROM ou flash sans secure element ; chaîne liée par hashes dans l'infrastructure du projet, pas une blockchain publique autonome ; l'ACK n'est pas une preuve optique.

Ne jamais annoncer : blockchain autonome ou décentralisée, signature matérielle inviolable, preuve optique, OTA universelle, validation matérielle de toutes les cartes. `tests/publicState.test.ts` refuse ces affirmations dans les surfaces publiques.

---

## Architecture réseau actuelle (post-migration)

- ancien modèle (déprécié) : `Web App → serveur → IP ESP locale`
- modèle actuel : `ESP → serveur (register + ping + pull + pull-frame)`
- le serveur est la source unique de vérité
- l'ESP est un client du serveur
- l'utilisateur dessine sur l'app web, jamais directement sur l'ESP
- aucun fetch sortant vers IP locale (plus de SSRF)

---

## Ce qui est en place et fonctionnel

### Routes serveur

| Route | État |
|-------|------|
| `POST /api/register` | ✅ Idempotent par MAC, retourne deviceId + pairCode, gère pools Redis |
| `POST /api/ping` | ✅ Met à jour lastPing/lastSeen |
| `GET /api/pull` | ✅ Retourne metadata légère (~300B) sans buffers pixel |
| `GET /api/pull-frame?fmt=bin` | ✅ Retourne 9472 bytes binaires (blackBuf + redBuf concaténés) |
| `GET /api/validate-candidate` | ✅ Metadata candidat uniquement (sans payload image) |
| `POST /api/validation-result` | ✅ Vote ESP, quorum, minage, broadcast |
| `POST /api/draw` | ✅ Auth HMAC, rate limit, archivage Redis |
| `POST /api/submit-candidate` | ✅ Crée le candidat Redis |
| `POST /api/onboard` | ✅ Associe pairCode → artistName |
| `POST /api/ack-frame` | ✅ Confirme l'affichage, supprime la frame Redis |
| `POST /api/personal-frame` | ✅ Frame personnelle par device |

### Firmware

| Fichier | État |
|---------|------|
| `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` | ✅ Fonctionnel, pipeline complet validé |
| `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` | 🔜 À porter vers la nouvelle architecture |

### Librairies serveur

Toutes fonctionnelles et à ne pas casser :
- `lib/chain.ts` — logique chaîne de blocs légère
- `lib/deviceStore.ts` — CRUD devices Redis, TTL 48h
- `lib/queue.ts` — store/retrieve frames Redis, FramePayload typé
- `lib/canvasToScreen.ts` — conversion canvas → buffers écran (`rgbaToScreenPayload` = encodeur pur testé bit à bit ; conventions à ne pas changer)
- `lib/rateLimit.ts` — rate limiting, blacklist, strikes
- `lib/crypto.ts` — SHA-256, computeDisplayTime
- `lib/screenProfiles.ts` — profils écrans, BUF_SIZE par type
- `lib/session.ts` — sessions HMAC

---

## Invariants critiques — ne jamais casser

### Mémoire ESP8266

```
blackBuf/redBuf → free() AVANT toute connexion TLS
blackBuf/redBuf → malloc() APRÈS fermeture TLS
http.useHTTP10(true) → obligatoire sur tous les GET streaming
/api/validate-candidate → ne retourne JAMAIS le payload image
/api/pull → ne retourne JAMAIS black/red dans le JSON
/api/pull-frame?fmt=bin → binaire brut uniquement, pas de JSON
```

### Sécurité serveur

```
Rate limit préservé sur tous les endpoints
Blacklist IP/device/MAC opérationnelle
Pas de fetch sortant vers IP locale
Pas d'état critique en mémoire Vercel (serverless-safe)
TTL sur tous les objets Redis (devices 48h, frames displayTime, locks 15min)
Toute logique de pool via Redis Sets : SADD/SREM idempotent
```

### Chaîne

```
blockHash stocké en EEPROM ESP (offset 32, 32 bytes)
parentHash vérifié à chaque bloc
displayTime calculé depuis score via computeDisplayTime()
castVote() retourne zeros si voteMap absent → détecter 409 côté serveur
```

---

## Prochains travaux

### V1 — Généralisation multi-écrans

Pour porter un nouvel écran, trois points à modifier :

**1. `/api/pull-frame/route.ts`**
- lire le profil depuis `screenProfiles.ts`
- pour BW/OLED : envoyer uniquement `blackBuf` (pas de concaténation)
- pour BWR : conserver `blackBuf + redBuf` concaténés
- ajouter header `X-Screen-Type` dans la réponse

**2. Firmware cible**
- définir `SCREEN_TYPE` et `BUF_SIZE` en constantes
- `doFetchFrame()` : adapter le nombre de buffers lus et l'appel `epd.Display()`
- conserver `readFull()` pour la lecture robuste

**3. `screenProfiles.ts`**
- ajouter le profil : `BUF_SIZE`, `bufferCount` (1 ou 2), `format` (`bw` ou `bwr`)

### V1 — Test multi-ESP en pool (FAIT : quorum multi-appareils observé sur les blocs #100, #101, #103, #104)

- vérifier que le quorum `ceil(poolSize × 0.51)` fonctionne avec plusieurs devices
- vérifier que `alreadyVoted` bloque correctement le double vote

### Chantiers suivants (voir `docs/RESTE_A_FAIRE_2026_10_14.md` et la feuille de route de `app/learn/data/roadmap.ts`)

- qualification matérielle des familles non encore observées au vote ;
- éligibilité par profil, reçus signés conservés dans le bloc, identités (preuve de possession de la clé) ;
- validation des animations par calcul (`pod-anim-v3`, inactif) ;
- OTA signée, portail Wi-Fi ;
- déjà livré (ne plus le replanifier) : vote v2 (SHA-256 + métriques entières + verdict), **signature Ed25519 réelle**, score composite calculé par les appareils.

---

## Contraintes absolues

- ne pas ajouter de base de données
- ne pas refaire les pages
- ne pas dupliquer la logique de dessin hors de `lib/drawEngine` (l'ancien hook `useCanvasDrawing` a été supprimé)
- ne pas remplacer `canvasToScreen.ts`
- ne pas transformer le projet en nouvelle app
- ne pas ajouter blockchain / wallet / seed / token maintenant (et ne pas décrire la chaîne comme une blockchain publique autonome)
- ne pas déployer ni pousser `main` sans autorisation explicite (audit puis GO)
- ne pas modifier le design global
- ne pas inventer une nouvelle architecture de fichiers
- ne pas faire de fetch sortant vers IP locale

---

## Format de rendu attendu

Quand tu modifies le projet :
1. liste les fichiers modifiés
2. liste les fichiers créés
3. donne le contenu complet de chaque fichier modifié/créé
4. ne donne pas des pseudo-diffs incomplets
5. ne propose pas une réarchitecture totale
6. vérifie que le build reste valide (TypeScript strict)
