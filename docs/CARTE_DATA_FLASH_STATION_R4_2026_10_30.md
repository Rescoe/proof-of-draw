# Carte de la data flash — station R4 TFT 1,8″ (`r4tft18`, 30/10/2026)

Source : les constantes du sketch (`pod_uno_r4_tft18_env.ino`), `pod_wifi_cfg.h` et `podOtaR4.h`, extraites et comparées par `tests/r4StationPortal.test.ts` (aucun chevauchement = test vert). La data flash de la UNO R4 fait 8 Ko (octets 0..8191, blocs d'effacement de 1 Ko) ; `EEPROM.*` et `DataFlashBlockDevice` adressent la même mémoire.

| Zone | Octets | Bloc | Écrit par | Remarque |
|---|---|---|---|---|
| Clé privée Ed25519 | 0..31 | 0 | génération des clés (une fois) | identité de l'appareil |
| Dernier bloc connu | 32..63 | 0 | pull | |
| Drapeau « clés générées » | 64 | 0 | génération | |
| Clé publique | 65..96 | 0 | génération | |
| Écran d'appairage montré | 97 | 0 | appairage | |
| Blocs possédés : tête, compte | 98, 99 | 0 | minage | |
| Blocs possédés : 10 emplacements de 32 o | 100..419 | 0 | minage | fin de l'identité : 419 |
| *(libre)* | 420..511 | 0 | — | |
| **Enregistrement Wi-Fi (portail)** | **512..616** (105 o : magie `PWC1`, longueurs, SSID, mot de passe, CRC-32) | 0 | portail, `WIFI-SETHEX`, `WIFI-CLEAR` | **seule zone que le module `pod_wifi_cfg.h` écrit** (boucles `e.write(OFF + i, …)`, testé) |
| *(libre)* | 617..2047 | 0..1 | — | |
| **Séquence OTA, bloc A** | 2048..3071 | 2 | client OTA (`seqCommit`) | `OTS1` + séquence + génération + CRC |
| **Séquence OTA, bloc B** | 3072..4095 | 3 | client OTA | alternance A/B ; la séquence effective = max(compilée, enregistrée) et ne baisse jamais |
| *(libre)* | 4096..8191 | 4..7 | — | le bloc 7 (journal de canari) n'est utilisé que par les builds de canari e-ink 2,9″ ; **verrou de vote** : n'existe que dans le canari TFT 2,8″ ; **aucun des deux n'existe sur la station** |

## Ce que le portail ne touche jamais
Identité (0..419), séquences OTA (2048..4095), blocs 4..7. Le portail n'efface aucun bloc : il écrit les 105 octets de l'enregistrement Wi-Fi puis les relit et les revalide (CRC) avant de déclarer le succès.

## Risque connu (non nouveau)
L'identité et l'enregistrement Wi-Fi partagent le bloc 0 : la bibliothèque `EEPROM` de la R4 réécrit le bloc de 1 Ko autour d'un octet modifié (lecture-modification-écriture). Une coupure d'alimentation pendant cette réécriture pourrait corrompre le bloc. C'est le même arrangement que la UNO R4 e-ink 2,9″ (portail validé sur carte le 25/10/2026) ; il n'a pas été essayé sur la station. **Mesure d'atténuation avant le flash : noter la clé publique et le `deviceId` de la station (visibles dans l'application) pour constater que l'identité est conservée.**

## Procédure de récupération USB
1. Mode chargeur d'amorçage : double appui rapide sur RESET (la LED « L » pulse) ; un nouveau port série apparaît.
2. Téléverser une image : `arduino-cli upload --fqbn arduino:renesas_uno:unor4wifi -p <port> --input-dir <dossier out>`. Un téléversement ne touche **pas** la data flash (identité, Wi-Fi et séquences restent).
3. Wi-Fi à refaire : au démarrage, pendant la fenêtre de 1,5 s du port série (115 200), envoyer `WIFI-PORTAL` (ouvre le portail), `WIFI-CLEAR` (efface l'enregistrement) ou `WIFI-SETHEX <ssid en hex>:<mot de passe en hex>` (enregistre sans portail). Le port série ne doit être ouvert par aucun autre programme pendant un téléversement (BOSSA échoue sinon).
4. Retour arrière de firmware : l'image précédente est reflashée par câble (aucun retour arrière automatique). La séquence OTA enregistrée ne baisse pas : une ancienne image reste fonctionnelle mais ne recevra une mise à jour que si sa séquence dépasse l'enregistrée.
