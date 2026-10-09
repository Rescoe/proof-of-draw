# Compilations UNO R4 — FIX3 (cf82fcc) → FIX3-R1 — arduino-cli, FQBN arduino:renesas_uno:unor4wifi, cœurs 1.5.3 ET 1.6.0, --warnings all, 09/10/2026

Marge statique = 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés) − RAM statique annoncée. TFT 2,8″ : bibliothèque SD de l'IDE passée par --library.

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (FIX3 → FIX3-R1) | Flash, cœur 1.6.0 (FIX3 → FIX3-R1) | RAM statique FIX3-R1 (octets) | Marge statique (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 120980 → 120796 (**-184**) | 120980 → 120796 (**-184**) | 22768 (**+0** sur FIX3) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 124012 → 123820 (**-192**) | 124012 → 123820 (**-192**) | 22768 (**+0** sur FIX3) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 120172 → 119948 (**-224**) | 120172 → 119948 (**-224**) | 19128 (**+0** sur FIX3) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 122892 → 122676 (**-216**) | 122892 → 122676 (**-216**) | 19128 (**+0** sur FIX3) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 135016 → 134800 (**-216**) | 135016 → 134800 (**-216**) | 21500 (**+0** sur FIX3) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 137728 → 137528 (**-200**) | 137728 → 137528 (**-200**) | 21500 (**+0** sur FIX3) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 130816 → 130600 (**-216**) | 130816 → 130600 (**-216**) | 20864 (**+0** sur FIX3) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 133440 → 133240 (**-200**) | 133440 → 133240 (**-200**) | 21424 (**+0** sur FIX3) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 149628 → 149404 (**-224**) | 149628 → 149404 (**-224**) | 21444 (**+0** sur FIX3) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | 128652 → 128972 (**+320**) | 128652 → 128972 (**+320**) | 22768 (**+0** sur FIX3) | 528 | 0 |
