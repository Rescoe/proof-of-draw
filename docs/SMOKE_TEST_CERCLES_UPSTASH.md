# Smoke test réel des cercles (Upstash, deux profils) — procédure courte

**Non exécuté à ce jour** : l'environnement de développement n'a ni Redis ni profils réels. À faire par le porteur (ou une session ayant accès à deux profils), en production ou en préproduction. Aucun FLUSHDB, aucun nettoyage global, aucune nouvelle base ; le script ne crée qu'UN cercle et le supprime.

## Préparation
1. Deux profils artistes distincts (A propriétaire, B invité), idéalement dans deux navigateurs ; un troisième (C) pour le non-membre, facultatif.
2. Pour chacun : copier le cookie `esp_session` (outils de développement → Application → Cookies) dans une variable d'environnement locale. **Ne jamais coller un cookie dans un message, un commit ou un journal** ; le script ne l'affiche pas.

## Lancer
```
COOKIE_A='esp_session=…' COOKIE_B='esp_session=…' COOKIE_C='esp_session=…' node scripts/smoke-circles.mjs https://proof-of-draw.vercel.app
```
Étapes vérifiées (✓/✗) : A crée → A invite B → B n'est pas membre avant d'accepter (404) → B voit l'invitation → B accepte lui-même → A voit 2 membres → B publie un message, A le lit → non-membre : 404 identique à un cercle inexistant (et ne lit pas les messages) → B quitte → B n'a plus accès → A supprime → le cercle n'existe plus.
Coût : une cinquantaine de commandes Redis au total ; limites de débit consommées : 1 création, 1 invitation, 1 message.

## Clés exactes à observer (console Upstash, lecture seule) — `{id}` = 20 hex affichés par le script, `{A}`/`{B}` = artistId
| Moment | Clé | Attendu |
|---|---|---|
| après création | `circle:{id}` (string), `circle:{id}:members` (hash `{A}`→nom), `artist:circles:{A}` (set ∋ id) | TTL ≈ 31 536 000 s |
| après invitation | `circle:{id}:pending` (champ `{B}`), `circle:invites:{B}` (champ `{id}`) | TTL ≈ 2 592 000 s ; `{B}` absent de `members` |
| pendant accept / invite | `lock:circle:{id}` | présent < 10 s puis ABSENT (TTL 10) |
| après acceptation | `circle:{id}:members` = {A, B} ; `artist:circles:{B}` ∋ id ; `pending` et `invites` SANS `{B}`/`{id}` | |
| après message | `circle:{id}:msgs` (liste, 1 entrée) | TTL ≈ 7 776 000 s |
| après départ de B | `members` = {A} ; `artist:circles:{B}` ∌ id | |
| après suppression | `circle:{id}`, `:members`, `:pending`, `:msgs` ABSENTS ; `artist:circles:{A}` ∌ id | |
| compteurs (expirent seuls) | `rl:circle:create:{A}`, `rl:circle:invite:{A}`, `rl:circle:message:{B}` | TTL = fenêtre |
Rien d'autre ne doit apparaître sous `circle:*` ou `artist:circles:*` pour ce test.

## Variante expiration (facultative, sans attendre 30 jours)
Dans la console, créer à la main un hash `circle:{id}:pending` avec un champ `{B}` = `{"name":"x","at":<ms d'il y a 31 jours>}` et le même `at` dans `circle:invites:{B}` : `GET /api/circles/{id}` (A) ne doit pas l'afficher et les deux champs doivent disparaître.
