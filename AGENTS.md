# AGENTS.md

> **ÉTAT CANONIQUE AU 29/10/2026 : lire d'abord `docs/ETAT_ACTUEL_CANONIQUE.md`, puis `docs/TAXONOMIE_FAMILLES_COMPOSITIONS_MATERIELLES.md`, `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` et `docs/INDEX_DOCUMENTATION.md`. Les sections datées plus bas sont historiques lorsqu'elles contredisent ces sources ou le code de `origin/main`.**

## Règles actuelles essentielles

- Le pipeline dessin → candidat → vote → bloc → diffusion → affichage → ACK est observé sur plusieurs profils ESP8266 et R4.
- L'OTA Internet signée est prouvée sur plusieurs profils ESP8266. Le porteur rapporte également deux OTA Internet R4 réussies ; leurs preuves précises restent à indexer dans la matrice.
- Un écran physique = mono-écran ; deux écrans ou plus = multiscreen. Ajouter seulement un capteur ne change pas la famille.
- Famille fonctionnelle, plateforme, profil matériel et cible OTA sont distincts. Une release OTA cible toujours le profil exact.
- Un appareil multiscreen conserve une identité et une voix.
- Toute conclusion nouvelle met à jour la matrice et, si elle change l'état transversal, `ETAT_ACTUEL_CANONIQUE.md`.
- Tout nouveau travail part d'un `main`/`origin/main` propre. Ne jamais réinitialiser un checkout sale ou divergent pour le « remettre à jour ».

## Mission

Le projet `proof-of-draw` est une application Next.js accompagnée de firmwares ESP8266 et UNO R4 WiFi. Il relie création web, validation distribuée, écrans e-ink/OLED/TFT, capteurs environnementaux et mises à jour OTA ciblées.

**Ne pas refaire l'application. Ne pas restructurer le projet. Ne pas refactoriser l'UI globalement.**

---

## Pipeline courant

```text
dessin/animation web → candidat → électorat → votes signés → quorum → bloc
→ conversion/diffusion par écran → téléchargement appareil → affichage → ACK
```

Ce pipeline est observé sur plusieurs profils. Consulter la matrice pour distinguer, profil par profil, compilation, hôte, carte, vote réel et OTA.

---

## Architecture réseau actuelle (post-migration)

- ancien modèle (déprécié) : `Web App → serveur → IP ESP locale`
- modèle actuel : `ESP → serveur (register + ping + pull + pull-frame)`
- le serveur est la source unique de vérité
- l'ESP est un client du serveur
- l'utilisateur dessine sur l'app web, jamais directement sur l'ESP
- aucun fetch sortant vers IP locale (plus de SSRF)

---

## Interfaces stables à préserver

### Routes serveur

| Route | État |
|-------|------|
| `POST /api/register` | ✅ Idempotent par MAC, retourne deviceId + pairCode, gère pools Redis |
| `POST /api/ping` | ✅ Met à jour lastPing/lastSeen |
| `GET /api/pull` | ✅ Retourne metadata légère (~300B) sans buffers pixel |
| `GET /api/pull-frame?fmt=bin` | ✅ Retourne un payload binaire dépendant du profil écran ; ne jamais figer ici une taille ou un nombre de plans |
| `GET /api/validate-candidate` | ✅ Metadata candidat uniquement (sans payload image) |
| `POST /api/validation-result` | ✅ Vote ESP, quorum, minage, broadcast |
| `POST /api/draw` | ✅ Auth HMAC, rate limit, archivage Redis |
| `POST /api/submit-candidate` | ✅ Crée le candidat Redis |
| `POST /api/onboard` | ✅ Associe pairCode → artistName |
| `POST /api/ack-frame` | ✅ Confirme l'affichage, supprime la frame Redis |
| `POST /api/personal-frame` | ✅ Frame personnelle par device |

### Firmwares

Les firmwares ESP8266 et R4 n'ont pas tous le même niveau de preuve. Ne pas maintenir ici une seconde matrice susceptible de vieillir : utiliser `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` et les rapports qu'elle cite.

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

## Travaux actuels

La liste courante est maintenue dans `docs/ETAT_ACTUEL_CANONIQUE.md`. Au 29/10/2026 : migration multiscreen BWR + OLED + DHT22, matrice/taxonomie, indexation des preuves OTA R4, vote complet des animations et scalabilité réseau. Les anciennes roadmaps datées restent des archives, pas une file de tâches automatique.

---

## Contraintes absolues

- ne pas ajouter de base de données
- ne pas refaire les pages
- ne pas dupliquer la logique de dessin hors de `lib/drawEngine` (l'ancien hook `useCanvasDrawing` a été supprimé)
- ne pas remplacer `canvasToScreen.ts`
- ne pas transformer le projet en nouvelle app
- ne pas ajouter blockchain / wallet / seed / token maintenant
- ne pas déployer sans autorisation explicite du porteur pour le lot courant
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
