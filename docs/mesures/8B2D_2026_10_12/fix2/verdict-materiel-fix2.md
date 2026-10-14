# Verdict matériel du canari TFT 2,8″ après REGISTER-STACK-FIX2 (`f1471d4`) — archivé tel que rapporté par le porteur

Source : message du porteur (13/10/2026). Le journal de DÉMARRAGE est archivé mot pour mot dans `journal-boot-canari-fix2-brut.txt` ; les journaux des frames suivantes n'ont PAS été transmis : leurs chiffres ci-dessous sont ceux du verdict, non rejouables.
Binaire : `r4tft28-2.5`, banderole `LOT8B2D-R4-TFT28-CANARY-1 | base 3239d2e | POD_CANARY=1 | AUCUN VOTE | compile Oct 12 2026 17:27:47` (l'empreinte du binaire ne contient pas le hash `f1471d4` : elle ne l'identifie pas — réserve déjà connue).

## Validé sur la carte
- démarrage, tactile (STMPE610 détecté), carte SD lisible ; Wi-Fi (pile dédiée 448–568 o utilisés, marges ≥ 904 o) ; Ed25519 (sign 1 316 / marge 924, verify 1 532 / marge 708) ;
- `POST /api/register` = 200 ; JSON register 496 o utilisés, marge 1 488 ; **retour de `doRegister` : pile principale 780 / 1 024, marge 244 o** (108 o avant FIX2 : +136 o) ; premier pull : 812 / 1 024, marge 212 o ; JSON pull jusqu'à 764 o, marge ≥ 1 220 ;
- plusieurs frames personnelles brutes de 153 600 o reçues, affichage TFT complet (320/320 lignes), cache SD réussi, ACK HTTP 200 ; transaction pull-frame : pile dédiée 1 244–1 252 o, marge 732–740 o ; pile HTTP : marge 804–832 o ;
- **pile principale au pire : 840 / 1 024, marge 184 o** (≥ 128 exigé, < 256 visé : réserve) ; tas après transaction ≈ 7 912 o, plus grand bloc 4 884 o, fragmentation ≈ 39–40 % ;
- plusieurs frames successives restent fonctionnelles après l'échec d'animation (échec fermé propre : ni tas, ni SD, ni réseau, ni affichage suivant corrompus).
- Le chemin vote n'a pas été exercé et reste absent du canari.

## Défaut établi
Avec un clip résident sur la SD : `[ANIM] mémoire insuffisante pour la lecture` puis `[ANIM] lecture impossible : animation abandonnée (l'affiche reste)`. Cause : le tas a ≈ 8 Ko libres mais aucun bloc contigu > 4 884 o ; le firmware alloue le clip entier (jusqu'à 9 216 o) puis 1 024 o de plus. Même défaut côté téléchargement (`fetchAnimToSd` : `malloc(announced)`).
Suite demandée par le porteur : toucher (masquer / restaurer le cartel), Reset puis restauration depuis la SD (à vérifier une fois), puis correctif d'animation EN FLUX (téléchargement direct vers la SD, lecture en flux).
