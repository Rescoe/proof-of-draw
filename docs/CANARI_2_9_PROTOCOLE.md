# Canari e-ink 2,9″ — protocole d'essai (06/10/2026)

Barrière **G5** de `REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md`. **Une seule carte**, le firmware `esp_eink_2.9BWR` v2.1 (vote v2 : l'ESP relit le dessin
candidat, recalcule SHA-256 + métriques entières, décide d'un verdict objectif, le signe et vote). Rien d'autre n'est reflashé.

## 0. Avant l'essai

| Contrôle | État |
|---|---|
| Serveur déployé avec le commit de ce jour (tri des frames, `castVote` atomique, rejets v2 non bloquants) | à faire par le porteur |
| Variables Vercel : `STRICT_SIGNATURE` et `PIN_DEVICE_KEY` **absentes ou `false`**, `ENFORCE_V2_REJECTIONS` **absente** | à vérifier |
| Firmware 2,9″ compilé (esp8266 3.1.2, `nodemcuv2:eesz=4M2M`) : RAM statique 34 664 / 80 192 o, aucune erreur | ✅ 06/10/2026 |
| Parité numérique C++ / TypeScript (`npm test`, test « firmware (g++) = TypeScript ») : 0 ppm d'écart, 5 écrans | ✅ 06/10/2026 (g++ : `C:/msys64/mingw64/bin/g++.exe`) |
| Wi-Fi saisi dans le `.ino` **uniquement sur votre copie locale**, jamais committé | à respecter |

## 1. Essai nominal (verdict attendu : `accept`)

1. Flasher la 2,9″. Laisser le Serial Monitor ouvert (115200) et **l'enregistrer dans un fichier**.
2. Dessiner depuis la page de dessin vers cet écran et envoyer.
3. Relever au Serial, dans l'ordre : `[PULL] Candidat en attente`, `[VALIDATE2-BEFORE]`, puis la ligne
   `[VALIDATE2] eink29bwr 9472 o en … ms | e=… t=… r=… s=… | verdict=accept`, la ligne `hash=…`, `Vote OK`, `BLOC MINE`, `[VALIDATE2-AFTER]`.
4. Le bloc apparaît, l'image s'affiche (chaîne complète V1 inchangée).

**Réussite** : `verdict=accept`, `Vote OK`, bloc miné ; `maxBlock` ≥ 20 000 avant chaque connexion TLS ; aucun redémarrage.

À conserver : le journal Serial complet, les journaux Vercel de `/api/validation-result` (cherchez `vote v2`, `signature`), la durée `en … ms`.

## 2. Refus forcé (verdict attendu : `reject`, hash)

1. Ajouter `#define POD_TEST_FLIP_BYTE` tout en haut du `.ino` (avant les `#include`), reflasher. **Un seul octet du flux reçu est modifié.**
2. Envoyer un dessin. Attendu au Serial : `verdict=reject hash`, `Vote OK` (le refus signé est accepté par le serveur).
3. Attendu côté Vercel : `REFUS v2 OBSERVÉ (non bloquant) … raison=hash … bloquerait=…` ; la réponse contient `rejectObserved:true`.
4. **Retirer la ligne `#define POD_TEST_FLIP_BYTE`** et reflasher la carte. Ne jamais laisser ce réglage en production.

**Réussite** : le refus est enregistré et visible, le candidat n'est **pas** supprimé (comité mixte : G1), aucune 403/422.

## 3. Ce qui doit être relevé et rapporté

`[VALIDATE2]` complet · `[MEM]`/`heap`/`maxBlock` avant et après · durée de téléchargement + calcul · `Vote OK` · le refus forcé · toute réponse 403/422 et la ligne
Vercel correspondante · nombre de commandes Redis consommées par le candidat (tableau de bord Upstash avant/après).

## 4. Lecture des échecs

| Symptôme | Cause probable |
|---|---|
| 403 « Signature invalide » | clé publique du serveur désynchronisée : le firmware refait un `register` ; réessayer |
| 422 « hash/métriques différents du serveur » | **vraie divergence** ESP ↔ serveur : conserver le journal complet, ne pas relancer en boucle |
| `lecture/calcul impossible (http=-1…)` | TLS impossible (tas fragmenté) : relever `maxBlock`, redémarrer la carte |
| `malloc scratch impossible` | tas insuffisant : relever `[VALIDATE2-BEFORE]` |
| rien après `Candidat en attente` | délai de validation (30 s) ; sinon relever `[PULL]` |

## 5. Interdits pendant l'essai

Pas de reflash des autres cartes · pas d'activation de `STRICT_SIGNATURE`, `PIN_DEVICE_KEY` ni `ENFORCE_V2_REJECTIONS` · pas de promesse publique de « validation vérifiée ».

## 6. Suite (dans l'ordre de la note de reprise)

Résultat du canari ⇒ P3 vers l'e-ink 2,7″ / OLED / TFT 1,8″ (une famille à la fois), puis R4, puis comité P5 et audit P6.
Reste de **P0** (non fait, volontairement avant l'essai) : vote compté **par profil**, **auteur exclu** du comité de son œuvre, éligibilité/ancienneté côté serveur,
récupération de clé par le propriétaire. Ces règles réduisent un comité d'une carte à zéro votant : elles exigent le mode `bootstrap` (validation **partielle**
affichée comme telle) avant d'être activées, sinon un essai à carte unique ne pourrait plus miner.
