# Chantiers en cours et matériel disponible — 25/10/2026

> **État historique du 25/10, remplacé pour les chantiers actuels par le plan du 28/10 : `PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md`.** Ne pas lire ce document comme l'état courant.

Document de reprise : ce qui est fait, ce qui est prouvé, ce qui attend, et dans quel ordre. La source des niveaux de preuve reste `docs/MATRICE_COMPATIBILITE_MATERIELLE.md`.

## 1. Matériel et appareils

| Appareil | Montage | Où | Remarque |
|---|---|---|---|
| `dev_MN67OG7R` « Roubzi » (banc) | ESP8266 + e-ink 2,9″ BWR + DHT22, **sans OLED** | chez le porteur | tourne en `eink29bwr-2.12` séquence 13 (mêmes sources que la release de `dev_T46HBXG1`) ; prévu pour rester branché sur une prise |
| `dev_KAD6PKC4` « Roubzi » | multiscreen : e-ink 2,7″ BW + OLED, **sans DHT22** | chez le porteur | **jamais de DHT22 sur un multiscreen** |
| `dev_T46HBXG1` « Claude 2 » | ESP8266 + e-ink 2,9″ BWR + OLED + DHT22 | chez l'ami, à distance | `2.12` téléchargée le 25/10 mais non appliquée ; en attente de son rebranchement |
| `dev_VIRBQRV1` | ESP8266 + TFT 1,8″ | chez le porteur | `tft18-2.9`, ne télécharge pas la release `tft18-2.10-ota7` ; diagnostic prévu le 26/10 au soir |
| UNO R4 WiFi + e-ink BWR | R4 e-ink 2,9″ | chez le porteur | disponible pour les essais R4 |
| UNO R4 + TFT 2,8″ | `r4tft28-2.6` | **essayé le 25/10 soir** | portail Wi-Fi validé de bout en bout (point d'accès, enregistrement, connexion, register), vote v2 observé dans le bloc #118, image reçue et affichée (confirmé par le porteur) ; branche `claude/r4-tft28-portail-vote` @355e5f2 poussée, PAS encore fusionnée |

## 2. État des chantiers

| Chantier | État | Prochaine étape |
|---|---|---|
| BWR + DHT22 (cartel capteur v3) | **clos** : `2.10` vue à l'œil par le porteur, OTA `2.8 → 2.9 → 2.10` | — |
| BWR + OLED + DHT22 (`2.12`) | validé sur le banc avec 2 048 o de tas réservés ; **jamais avec un vrai OLED** | rebranchement chez l'ami ; relire les journaux Vercel (`[ota-announce]` puis `[ota-image] OK`, réinscription en `2.12`) |
| OLED comme écran réseau (images, animations, température) | non commencé | grand chantier : pilote OLED léger, profil/famille propre, vote, page Installer |
| TFT 1,8″ + DHT22 | release `tft18-2.10-ota7` annoncée, jamais téléchargée par la carte | série de `dev_VIRBQRV1` (cause du refus) ; image allégée (textes en flash, morceaux, DHT22) |
| Mesures publiques | fusionnées : publiques par défaut, interrupteur par appareil, message fermable | afficher aussi le nom donné et l'identifiant `dev_…` partout (voir § 4) |
| Galerie / explorateur de chaîne | fusionnée : toute la chaîne (#0 à #116), recherche par numéro | — |
| Cartel d'une frame personnelle | corrigé côté serveur (date de minage du bloc d'origine) | vérifier sur un écran |
| Pilote e-ink 2,9″ V4 | `ReadBusy` probablement à polarité inversée : 3 × 15 s de délai par rafraîchissement, écran blanc 2 à 4 minutes ; **non corrigé** | essai sur le banc (jamais d'abord à distance) |
| UNO R4 e-ink 2,9″ : vote v2 et OTA | vote v2 observé en production (14/10) ; OTA R4-B : lot hors matériel livré, **jamais essayé sur carte** | protocole `docs/PROTOCOLE_MATERIEL_R4B_2026_10_17.md`, étape S1 seulement avec un GO explicite |
| UNO R4 + TFT 2,8″ | canari sans vote validé (13/10) ; voie de vote non traitée (marge statique 120 o) | essayé le 25/10 (portail + image) ; vote réel : marge statique 120 o à traiter ; fusion de la branche à faire |

## 3. Règles apprises ce jour

- **Toute image pour une carte distante est construite depuis les sources de `origin/main` et essayée d'abord sur le banc** (même séquence ± 1). Le 25/10, la `2.12` de l'ami était la première construite depuis `main` et n'avait jamais démarré ; elle a ensuite démarré sur le banc (séquence 13), mais il fallait le faire avant.
- Un envoi à distance est un **seul essai** : pas de retour arrière automatique, pas de reflash possible, aucune série visible. La porte `ota:kill` ouverte signifie que **fusionner une release ciblée l'envoie** (voir `docs/POLITIQUE_PORTE_OTA_2026_10_25.md`).
- Une page publique du réseau peut afficher un état plus vieux que celui du profil du propriétaire : ne jamais en tirer « hors ligne » sans croiser avec le profil.
- La fragmentation du tas varie d'un démarrage à l'autre (bloc libre de 17 à 36 Ko) : une OTA peut être refusée sans risque (< 24 000 o contigus) et réessayée.
- Suite de tests : sans le PATH de winlibs (`export PATH=/c/Users/thibf/tools/winlibs-14.2/mingw64/bin:$PATH`) et sans PowerShell pour les harnais C++, environ 75 tests échouent déjà sur `main` (R4, TFT 2,8″, canaris ESP8266, DHT22). Ces échecs ne sont pas des régressions.
- `build-bwr.mjs` accepte `--src <dossier>` (construire depuis un worktree de `main`) et `--ballast N` (banc seulement : simule un OLED).

## 4. À faire, par ordre

1. Journaux Vercel de `dev_T46HBXG1` après le rebranchement (annonce, téléchargement, réinscription).
2. TFT 1,8″ (26/10 au soir) : série de `dev_VIRBQRV1`, puis image allégée sur le banc avant toute distribution.
3. Afficher le nom donné **et** l'identifiant `dev_…` dans la vue réseau, la constellation et le panneau latéral (la liste « Mes ESP » les montre déjà).
4. R4 e-ink 2,9″ : relever l'état du firmware en place, puis vote v2 et OTA R4 (étape S1 avec GO).
5. Pilote e-ink V4 (polarité de BUSY) sur le banc.
6. OLED réseau (grand chantier) après la validation du BWR + OLED + DHT22 chez l'ami.
