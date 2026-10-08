# Compilations UNO R4 — avant (HEAD c14df72) / après (STACK-FIX1) — arduino-cli, FQBN arduino:renesas_uno:unor4wifi, --warnings all, 08/10/2026

Marge statique = 32 768 − 9 472 (tas 8 192 + pile 1 024 + vecteurs 256 réservés) − RAM statique annoncée.
TFT 2,8″ : bibliothèque SD fournie par l'IDE passée par --library (absente du répertoire utilisateur d'arduino-cli sur ce poste, avant comme après).

| Firmware | Rendu v1 | Flash avant | Flash après | Δ flash | RAM statique avant | RAM statique après | Δ RAM | Marge statique après (o) | Avertissements du projet |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R4 e-ink 2,9″ BWR | OFF | 118460 | 119604 | **+1144** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 121492 | 122628 | **+1136** | 22768 | 22768 | **+0** | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 117588 | 118748 | **+1160** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 120300 | 121460 | **+1160** | 19128 | 19128 | **+0** | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 132200 | 133384 | **+1184** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 134912 | 136096 | **+1184** | 21500 | 21500 | **+0** | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 128176 | 129360 | **+1184** | 20864 | 20864 | **+0** | 2432 | 0 |
| R4 TFT 1,8″ | ON | 130800 | 131976 | **+1176** | 21424 | 21424 | **+0** | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 146628 | 147812 | **+1184** | 21444 | 21444 | **+0** | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI | — | 123644 | — | — | 22768 | — | 528 | 0 |
