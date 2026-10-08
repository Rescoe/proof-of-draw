# Sauvegarde d'avant le lot 8B-2A (08/10/2026)

Copie des fichiers de firmware modifiés par l'intégration INACTIVE du rendu v1 (`POD_RENDER_V1`, 0 par défaut) : les quatre `.ino` canaris et les pilotes e-ink (`epd2in9b_V4.cpp/.h`, `epd29b.h`).
Servent de référence à `tests/renderFirmware.test.ts` : avec `POD_RENDER_V1 = 0`, chaque fichier d'origine doit être retrouvé, au texte près (lignes vides et espaces finaux ignorés).
Les deux copies de `epd2in9b_V4.*` ont été nettoyées de leurs espaces finaux (contrôle `git diff --check`) ; aucun autre octet n'a été touché.
Aucun fichier `secrets.h` ici : les identifiants Wi-Fi ne sont jamais copiés.
