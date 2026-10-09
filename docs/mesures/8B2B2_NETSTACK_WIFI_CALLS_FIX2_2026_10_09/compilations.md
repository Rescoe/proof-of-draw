# Compilations UNO R4 — WIFI-CALLS-FIX1 (297251d) → NETSTACK-WIFI-CALLS-FIX2 — arduino-cli, FQBN arduino:renesas_uno:unor4wifi, cœurs 1.5.3 ET 1.6.0, --warnings all, 09/10/2026

Marge statique = 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés) − RAM statique annoncée. TFT 2,8″ : bibliothèque SD de l'IDE passée par --library.

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (WIFI-CALLS-FIX1 → WIFI-CALLS-FIX2) | Flash, cœur 1.6.0 | RAM statique (o) | Marge statique (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 121796 → 121844 (**+48**) | 121796 → 121844 (**+48**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 124812 → 124876 (**+64**) | 124812 → 124876 (**+64**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 120956 → 121004 (**+48**) | 120956 → 121004 (**+48**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 123676 → 123724 (**+48**) | 123676 → 123724 (**+48**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 135784 → 135848 (**+64**) | 135784 → 135848 (**+64**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 138512 → 138560 (**+48**) | 138512 → 138560 (**+48**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 131584 → 131648 (**+64**) | 131584 → 131648 (**+64**) | 20864 → 20864 (**+0**, 2 cœurs) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 134208 → 134272 (**+64**) | 134208 → 134272 (**+64**) | 21424 → 21424 (**+0**, 2 cœurs) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 150396 → 150444 (**+48**) | 150396 → 150444 (**+48**) | 21444 → 21444 (**+0**, 2 cœurs) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | 130468 → 130684 (**+216**) | 130468 → 130684 (**+216**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
