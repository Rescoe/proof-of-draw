# API de curation v1 (Proof of Draw → Néo-RESCOE)

Contrat **public, en lecture seule**, versionné (`version: 1`). Créé le 2026-11-20 pour le pont 1 de Néo-RESCOE (file de propositions de curation). Aucun secret, aucune écriture : un refus de curation côté Néo ne supprime rien ici.

## Routes

| Route | Rôle |
| --- | --- |
| `GET /api/v1/curation/works?before=<blockIndex>&limit=<1..100>` | Œuvres, plus récentes d'abord. `next` = valeur à passer en `before` pour la page suivante, `null` en fin de liste. |
| `GET /api/v1/curation/works/{hash}` | Une œuvre. 404 si absente ou si le bloc n'est pas exposable. |
| `GET /api/v1/curation/works/{hash}/image.svg?scale=1..8` | Image pixel-art, servie en ligne (immuable, cache d'un an). |

CORS ouvert (`*`) ; cache CDN de 60 s sur la liste.

## Objet `work`

`id` (hash de bloc, 64 hex, stable), `kind` (`draw` | `animation`), `title`, `artist`, `blockIndex`, `minedAt` (ISO UTC), `screen`, `validation` (`{approvals, rejects}` ou `null`), `cartel` (`top` : « date · bloc #n », `bottom` : « Artiste — Titre »), `hashes` (`block`, `image`, `actions`), `links` (`page`, `image`, relatifs à l'origine de l'API).

## Ce qui n'est jamais exposé

Identifiants d'appareils (`deviceId`, `minerDeviceId`, `ownerDeviceId`, `validatorIds`), propriétaire d'écran, preuves de replay. Les blocs ANA (`source: "ana-agent"`) sont exclus : ils ont leur propre flux.

## Limites connues

- La liste lit les **100 derniers blocs** (`chain:recent`), comme `/api/blocks` ; un bloc plus ancien reste lisible par son hash.
- Pas encore de lien direct vers un bloc dans la galerie PoD (`links.page` renvoie à `/gallery`).
- Les collections et la décision de curation vivent dans Néo-RESCOE, pas ici.

Code : `lib/curationFeed.ts` (pur), tests `tests/curationFeed.test.ts`.
