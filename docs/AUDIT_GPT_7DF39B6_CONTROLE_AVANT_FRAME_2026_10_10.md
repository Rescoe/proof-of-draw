# Audit GPT — `7df39b6` : contrôle matériel avant frame personnelle

| Champ | Valeur |
|---|---|
| Date | 10/10/2026 |
| Commit essayé | `7df39b6`, drapeaux locaux `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Verdict code `doValidate` | **ACCEPTÉ SOUS RÉSERVE matérielle : aucun candidat donc parseur/vote non exercés** |
| Verdict contrôle register/pull | **ACCEPTÉ** |
| Étape autorisée | **Une frame personnelle, sans publication ni candidat** |
| Redis / Neon | Redis +0, Neon 0 |

## 1. Contrôle matériel

- register JSON : 496 octets utilisés, marge 1 488, erreur 0, statut 1 ;
- pull JSON : 700 octets utilisés, marge 1 284, erreur 0, statut 1 ;
- PodNet : marge 844 à 848 octets ;
- pile principale après register : marge 240 octets ;
- pile principale après pull : marge 136 octets ;
- journal : marge 1 056 octets ;
- aucun marqueur détruit, aucun verrou, aucune phase fautive ;
- aucun candidat, donc aucune ligne `validate JSON` et aucun vote.

La limite explicite d'imbrication ArduinoJson à 8 ne dégrade pas les réponses réelles register/pull. Le chemin `doValidate` respecte dans le diff l'ordre : transaction HTTP fermée, décodage sur pile de travail, validation des bornes, puis seulement signature et vote.

## 2. Réserve avant push

`git diff --check 231393d..7df39b6` échoue à cause d'espaces finaux présents dans plusieurs fichiers texte de mesures sous `docs/mesures/8B2B2_DOVALIDATE_JSON_STACK_FIX1_2026_10_10/`.

Ces espaces n'affectent ni le firmware ni le test matériel. Ils doivent néanmoins être nettoyés avant push, sans modifier les chiffres, sous forme d'un amendement local ou d'un correctif documentaire séparé. Le commit final doit repasser `git diff --check`.

## 3. Test autorisé : une frame personnelle

Utiliser uniquement l'action personnelle `send-to-screen`, sans publier un dessin dans le réseau et sans créer de candidat. Après mise en file, attendre le prochain pull ou redémarrer une seule fois la carte pour obtenir un pull immédiat.

Résultats attendus :

1. pull HTTP 200 et `pull JSON` erreur 0 / statut 1 ;
2. `[PULL] nouvelle frame ...` ;
3. transaction de lecture de frame sans erreur ;
4. `[RENDER] frameHash=...` ;
5. `[RENDER] calculé ET remis au pilote ... renderHash=...` ;
6. rendu physique correct, y compris plans noir/rouge et cartel en mode `fit` ;
7. `[ACK] ... -> OK` ;
8. contrôle `apres ACK` sans alerte, marqueur intact, marge principale >= 128 octets ;
9. tas libre récupéré et aucun watchdog/BUSY expiré.

Au premier verrou, candidat, `validate JSON`, vote inattendu, BUSY expiré ou rendu partiel : débrancher et conserver tout le journal. Un échec après le début du rendu peut laisser l'écran partiellement modifié ; l'absence d'ACK reste alors la garantie serveur.

## 4. Ce qui restera après la frame

- un canari séparé de la voie vote pour exercer réellement `validate JSON`, la lecture du candidat, Ed25519 et le POST de vote ;
- la propagation des piles de travail aux quatre autres firmwares R4 ;
- le TFT 2,8 pouces reste bloqué ;
- signature du rapport de rendu et OTA restent hors de ce test.
