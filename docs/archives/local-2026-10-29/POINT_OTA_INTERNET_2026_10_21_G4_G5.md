# Point de reprise — OTA Internet ESP8266 TFT 1,8″ — 21 octobre 2026

## État et preuves disponibles

- `[carte, rapport Claude]` G1 : client `tft18-2.7`, séquence 4, installé par câble sur `dev_VIRBQRV1` après sauvegarde complète ; identité et Wi-Fi conservés. Un vote réel a été accepté, bloc #110 miné, image affichée et ACK 200. Une première capture de 240 s n'avait reçu aucun candidat ; une capture ultérieure plus longue a permis le vote.
- `[git local / rapport Claude]` G2 : release canari `tft18-2.8-ota5`, séquence 5, ciblant uniquement `dev_VIRBQRV1`, commit `99afc7f` sur `claude/ota-canary-prod-prep`. Fichier OTA signé : SHA-256 `25408a817f8500f67ceaf7578bfffd89b699e79446c9435651639a96a765ae41`. Ce n'est pas le SHA du binaire installé B (`25db6a17…`).
- `[rapport Claude]` G3 : branche minimale poussée, Preview Vercel construit mais protégé. Les 85 commits de la branche de travail ne sont pas à pousser pour ce canari.
- `[rapport utilisateur]` Dans la console Upstash, `SET ota:kill 1` a répondu OK, puis `GET ota:kill` a renvoyé `1` et `TTL ota:kill` `-1`. `chain:head` indiquait le bloc #110, cohérent avec le vote rapporté ; ce rapprochement ne remplace pas une vérification directe de la configuration Redis de Vercel.
- `[rapport utilisateur]` Trois variables OTA ont été renseignées sur Vercel ; leur environnement et leurs valeurs ne sont pas vérifiables depuis cet audit. Aucun secret ne figure dans cette note. Un redéploiement a été effectué après la première variable ; la chronologie précise de fusion et de déploiement est à confirmer.
- `[rapport utilisateur]` La sonde HTTPS sur l'URL de production a reçu `503 « distribution suspendue »` pour la release, puis un nouveau `GET ota:kill` a renvoyé `1`. Sous réserve que cette réponse provienne bien de la route OTA attendue et sans changement entre les lectures, c'est cohérent avec une release chargée et un kill-switch actif. Le commit exact déployé, le résultat de la PR et l'identité de la base utilisée par Vercel restent à confirmer dans les interfaces.

## Impact et risques

La distribution Internet est apparemment en place, mais **aucune OTA Internet A → B n'a encore été observée sur la carte**. Le client peut agir automatiquement dès qu'une annonce éligible est reçue : ne pas supprimer `ota:kill` avant que le banc soit prêt et qu'un GO G5 explicite soit donné. Ne pas vider la base ni supprimer cette clé accidentellement. Le kill-switch empêche les nouvelles annonces et téléchargements ; il n'interrompt pas une écriture déjà engagée. Pas de rollback automatique : récupération par câble à partir d'une sauvegarde sensible, locale et non commitée.

Une validation de l'OTA sur cette carte ne généralise pas aux autres ESP ou à l'UNO R4. La sécurité et les ressources restent à mesurer sur matériel : TLS, signature, mémoire, confirmation de santé, identité, Wi-Fi, image relue et nouveau vote. Le pull reste non authentifié ; la limitation par IP peut affecter des appareils derrière la même IP publique.

## Avant G5

1. En lecture seule dans Vercel/GitHub : confirmer la PR ou le déploiement qui a mis la route en production, le commit exact, le statut Ready, les environnements des trois variables et la correspondance entre la base Redis Vercel et celle dont la clé a été lue. Ne pas afficher ni transmettre les valeurs secrètes.
2. Rejouer les contrôles hôte et auditer le banc G5 sur le code réel : capture série, porte fermée avant lancement, absence de reset après ouverture, fermeture et vérification, absence de retry, sauvegarde, relecture du SHA B et vote. Son pilote série et ses commandes de porte n'ont pas encore été éprouvés sur ce parcours matériel.
3. Choisir un pilotage manuel guidé ou des commandes automatiques de lecture/ouverture/fermeture ; ne pas transmettre de jetons Upstash dans le chat ou dans une ligne de commande visible. Prévoir une fermeture manuelle immédiate en cas d'interruption et vérifier `GET ota:kill` et `TTL`.
4. Préparer une séquence de canari et demander le GO G5 distinct. Tant que ce GO n'est pas accordé : aucun `DEL ota:kill`, aucun flash et aucune modification des variables ou de la production.

## Références

- `docs/PROCEDURE_G4_INTERFACES_WEB_2026_10_21.md` ; `docs/PLAN_G4_OPERATIONNEL_2026_10_21.md` ; `docs/PROTOCOLE_CANARI_OTA_INTERNET_2026_10_20.md`.
- `ota-lab/esp8266-canary/canary/internet-canary.mjs` et `ota-lab/esp8266-canary/tools/run-internet-canary.mjs`.
- Les événements externes ci-dessus sont des déclarations et journaux transmis par l'utilisateur ou Claude, pas une vérification directe des interfaces par Codex.
