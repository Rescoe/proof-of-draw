# Handoff Claude Cloud — correctif de lecture SSL bornée

## Statut

Ce document ouvre une reprise **manuelle** en session Claude Cloud. La boîte `docs/ORCHESTRATION/` et son `NEXT_TASK.md` à `FIN` décrivent une ancienne fenêtre autonome terminée le 06/10/2026 : ils sont historiques et ne bloquent pas cette tâche explicitement autorisée par le porteur.

Rôles applicables :

- porteur : décisions, flash, essais matériels, merge/déploiement ;
- GPT/Codex : orchestrateur et auditeur indépendant ;
- Claude Cloud : implémenteur sur une branche isolée.

## Base et état local

- base fonctionnelle et instrumentée : `3387088` ;
- le commit conserve `POD_RENDER_V1=0` et `POD_CANARY=0` ;
- sur la machine du porteur uniquement, ces deux drapeaux valent temporairement `1/1` pour flasher le canari ; cette différence locale et `secrets.h` ne doivent jamais être copiés ni commités ;
- les copies Arduino locales de `Ed25519StackProbeUnoR4` sont des adaptations IDE, pas des sources du lot ;
- journal AUDIT5 : `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11/journal-audit5-3387088-materiel.txt` ;
- verdict GPT : `docs/AUDIT_GPT_AUDIT5_PULLFRAME_2026_10_11.md`.

## Tâche confiée à Claude Cloud

### Objectif unique

Implémenter `PULLFRAME-BOUNDED-SSL-FIX1` : un correctif de production étroit pour le téléchargement de frame sur UNO R4 WiFi + e-ink 2,9 pouces, puis préparer un canari. Ne pas propager aux autres firmwares avant le résultat matériel.

### Lecture obligatoire

- `AGENTS.md`
- `CLAUDE.md`
- `docs/PLAN_COLLABORATION_GPT_CLAUDE_POD.md`
- `docs/PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md`
- `docs/PLAN_REDIS_200K.md`
- `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11.md`
- `docs/AUDIT_GPT_AUDIT5_PULLFRAME_2026_10_11.md`
- `docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md`
- `docs/CANARY_R4_EINK29_RENDU_V1_2026_10_08.md`
- `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino`
- `consensus-pod/src/adapters/podNetStack.h`
- les sources WiFiS3 réellement utilisées par les cœurs Renesas 1.5.3 et 1.6.0 : `WiFiSSLClient::_read`, `WiFiClient::RX_BUFFER_DIM`, `ModemClass::buf_read`.

### Verdict matériel gelé

- phase 9 atteinte : `client.print` est revenu ;
- journal final : `M93 V59 R54#` ;
- `abort()` appelée pendant `WiFiSSLClient::read()` ;
- tas avant lecture : 2 976 octets libres, sommet vierge contigu 1 888 octets ;
- aucune fuite progressive observée ;
- register, pull JSON, Wi-Fi, PodNet, Ed25519 et journal étaient sains.

### Contraintes impératives

1. Ne modifier aucun fichier du cœur Arduino installé.
2. Ne pas installer de `new_handler` et ne pas redéfinir globalement `operator new`.
3. Ne pas se contenter de réduire `n` chez `Reader` : prouver que la commande AT `_SSLCLIENTRECEIVE` réelle est bornée.
4. Préférer un client/adaptateur local au projet avec réception modem bornée (240 octets est une hypothèse à vérifier), ou démontrer une solution meilleure.
5. Préserver exactement l'ordre et le contenu des octets, sans perte, duplication ni troncature.
6. Échec fermé : pas d'ACK, de succès de rendu ou de vote après lecture incomplète.
7. Aucun changement serveur, Redis, Neon, protocole, polling, vote, OTA ou format de frame.
8. Aucun secret, `secrets.h`, binaire ou fichier généré.
9. Drapeaux `POD_RENDER_V1` et `POD_CANARY` à `0/0` dans le commit.
10. R4 e-ink 2,9 pouces seulement ; aucune propagation avant canari réussi.
11. Ne pas pousser/merger sur `main`, ne pas déployer, ne pas créer de PR sans autorisation.
12. Un seul lot et un seul commit fonctionnel, rapport séparé si nécessaire.

### Preuves attendues

- test hôte reproduisant l'abandon de l'ancien chemin sous une contrainte de bloc contigu ;
- tests du client borné : réponses de plusieurs tailles, fragmentation, lecture partielle, timeout, corps tronqué et octet en trop ;
- preuve que la borne s'applique à `_SSLCLIENTRECEIVE` ;
- comparaison octet par octet d'une frame complète ;
- compilation Renesas 1.5.3 et 1.6.0, OFF/ON/canari ;
- mesures flash, RAM et pile ;
- `npm test`, `npx tsc --noEmit`, ESLint, `git diff --check` ;
- documentation et protocole matériel utilisant une seule frame personnelle, aucun dessin/candidat/vote.

### Livraison attendue

Rapport : commit, fichiers, objectif, coûts Redis/Neon, mémoire/flash, tests, limites, rollback, statut matériel honnête. S'arrêter avant flash et propagation pour audit GPT/Codex.
