# Compilations UNO R4 — avant (HEAD 1feb5cc) / après (NETSTACK-FIX1) — arduino-cli, FQBN arduino:renesas_uno:unor4wifi, cœur 1.6.0, --warnings all, 09/10/2026

Marge statique = 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés) − RAM statique annoncée. TFT 2,8″ : bibliothèque SD de l'IDE passée par --library.

| Firmware | Rendu v1 | Flash avant | Flash après | Δ flash | RAM statique avant | RAM statique après | Δ RAM | Marge statique après (o) | Avertissements du projet |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R4 e-ink 2,9″ BWR | OFF | 119588 | 120388 | **+800** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 122620 | 123420 | **+800** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 118748 | 119564 | **+816** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 121460 | 122276 | **+816** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 133384 | 134384 | **+1000** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 136096 | 137112 | **+1016** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 129360 | 130176 | **+816** | 20864 | 20864 | **+0** | 2432 | 0 |
| R4 TFT 1,8″ | ON | 131976 | 132816 | **+840** | 21424 | 21424 | **+0** | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 147812 | 148948 | **+1136** | 21444 | 21444 | **+0** | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | — | 126572 | — | — | 22768 | — | 528 | 0 |
