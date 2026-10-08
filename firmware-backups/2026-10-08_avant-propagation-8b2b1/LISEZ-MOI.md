# Sauvegarde d'avant le lot 8B-2B-1 (08/10/2026)

Copie des fichiers modifiés par la propagation INACTIVE du rendu v1 (`POD_RENDER_V1`, 0 par défaut) aux quatre derniers firmwares à cartel gravé : les quatre `.ino` e-ink 2,7″ (ESP8266 solo / + OLED, UNO R4 solo / + OLED), leurs pilotes `epd2in7_V2.cpp/.h`, et le `.ino` UNO R4 e-ink 2,9″ (rétro-ajusté : le renderer partage la zone de `qrData`).
Servent de référence à `tests/renderFirmware.test.ts` : avec `POD_RENDER_V1 = 0`, chaque fichier d'origine doit être retrouvé, au texte près (lignes vides et espaces finaux ignorés).
Les copies des pilotes ont été nettoyées de leurs espaces finaux et lignes vides finales (contrôle `git diff --check`) ; aucun autre octet n'a été touché. Aucun `secrets.h` ici : les identifiants Wi-Fi ne sont jamais copiés.
