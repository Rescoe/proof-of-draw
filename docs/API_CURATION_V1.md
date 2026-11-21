# API de curation v1 (Proof of Draw → Néo-RESCOE)

Contrat **public, en lecture seule**, versionné (`version: 1`). Créé le 2026-11-20 pour le pont 1 de Néo-RESCOE (file de propositions de curation). Aucun secret, aucune écriture : un refus de curation côté Néo ne supprime rien ici.

## Routes

| Route | Rôle |
| --- | --- |
| `GET /api/v1/curation/works?before=<blockIndex>&limit=<1..100>` | Œuvres, plus récentes d'abord, dans la fenêtre des 100 derniers blocs. `next` = valeur à passer en `before`, `null` en fin de fenêtre. |
| `GET /api/v1/curation/works?from=<hash>&limit=<1..100>` | **Historique complet** (ajout du 2026-11-21) : suit la chaîne vers le passé à partir du bloc `from` (inclus). Chaque page rend `nextFrom` (hash à repasser en `from`), `null` au premier bloc. `nextFrom` est aussi rendu par la liste sans `from` : le client lit 100 par 100 jusqu'à `null`. Cache d'une heure. |
| `GET /api/v1/curation/works/{hash}` | Une œuvre. 404 si absente ou si le bloc n'est pas exposable. |
| `GET /api/v1/curation/works/{hash}/image.svg?scale=1..8` | Image pixel-art, servie en ligne (immuable, cache d'un an). |
| `GET /api/v1/curation/works/{hash}/clip` | Animations seulement : clip binaire PBC1 (≤ 9 Ko), toutes les images, leurs délais et couleurs. Immuable, cache d'un an. |
| `GET /api/v1/curation/works/{hash}/replay` | Dessins qui ont un replay : `{ version: 1, events: ReplayEvent[] }` (traits, couleurs, rythme). Cache d'un jour. |

CORS ouvert (`*`) ; cache CDN de 60 s sur la liste.

## Objet `work`

`id` (hash de bloc, 64 hex, stable), `kind` (`draw` | `animation`), `title`, `artist`, `blockIndex`, `minedAt` (ISO UTC), `screen`, `validation` (`{approvals, rejects}` ou `null`), `cartel` (`top` : « date · bloc #n », `bottom` : « Artiste — Titre »), `hashes` (`block`, `image`, `actions`), `scores` (`score`, `draw`), `animation` (`{frames, loops, playMs}` ou `null`), `geometry` (`{strokes, durationMs, colors}` ou `null`), `links` (`page`, `image`, `clip`, `replay` : relatifs à l'origine de l'API ; `clip`/`replay` valent `null` quand la donnée n'existe pas). Ajout du 2026-11-21, compatible : les clients v1 qui ignorent ces champs continuent de fonctionner.

## Ce qui n'est jamais exposé

Identifiants d'appareils (`deviceId`, `minerDeviceId`, `ownerDeviceId`, `validatorIds`), propriétaire d'écran. Le replay exposé ne contient que les gestes du dessin. Les blocs ANA (`source: "ana-agent"`) sont exclus : ils ont leur propre flux.

## Limites connues

- Sans `from`, la liste lit les **100 derniers blocs** (`chain:recent`) ; l'historique plus ancien se lit avec `from`/`nextFrom` (un accès Redis par bloc, d'où la limite de 100 par page).
- Pas encore de lien direct vers un bloc dans la galerie PoD (`links.page` renvoie à `/gallery`).
- Les collections et la décision de curation vivent dans Néo-RESCOE, pas ici.

Code : `lib/curationFeed.ts` (pur), tests `tests/curationFeed.test.ts`.
