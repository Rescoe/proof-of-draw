# Compilations avec le VRAI pipeline arduino-cli (FIX1, 12/10/2026)

Cause de l'échec chez le porteur (arduino-cli 1.4.1, cœur `arduino:renesas_uno` 1.6.0, SD 1.3.0, `-DPOD_RENDER_V1=1 -DPOD_CANARY=1`) : `pod_uno_r4.ino:377:36: error: 'F' is not a type`.
Le générateur de prototypes d'Arduino (arduino-ctags) donne à un **template défini dans un .ino** un prototype sans sa ligne `template <typename F>` : `onSd` (défini dans le .ino par `cab924b`) cassait la compilation. Correction : `onSd` / `onSdDirect` sont dans `arduino_uno_r4/pod_uno_r4/pod_sd_stack.h` (les en-têtes ne passent pas par ce générateur), logique et tailles de pile inchangées.

| fichier | contenu |
|---|---|
| `avant-fix1-cab924b-canari-1.6.0-ERREUR.log` | la MÊME erreur (`377:36`) reproduite sur `cab924b` avec ce pipeline : preuve que l'environnement reproduit le défaut |
| `off_160.log`, `can_160.log`, `off_153.log`, `can_153.log` | commande, sortie et avertissements bruts des quatre compilations du correctif (production / canari × cœur 1.6.0 / 1.5.3), **OK** (seuls les espaces en fin de ligne ont été retirés des journaux) |
| `real.sh` | le script utilisé (arduino-cli sur le DOSSIER du sketch tel quel, aucune enveloppe) |

Résultats : production 163 460 o de flash / 21 676 o de RAM statique ; canari 155 560 o / 21 672 o (identiques sur les deux cœurs).

**Différences avec la chaîne du porteur (à lire avant de comparer)** : cloud = arduino-cli **1.1.1** (le porteur : 1.4.1), cœurs Renesas 1.5.3 et 1.6.0 installés en `hardware/local` (FQBN `local:renesas_uno:unor4wifi`), `arm-none-eabi-gcc` du système (13.x) au lieu de celui du cœur — d'où `-std=gnu++14` ajouté en plus (sinon « reference to 'byte' is ambiguous » dans WiFiS3, sans rapport avec le sketch), bibliothèque **SD 1.3.0** (étiquette git `1.3.0`), Adafruit ILI9341 1.6.4, STMPE610 1.1.6, GFX 1.12.6, BusIO 1.17.4, ArduinoJson 7.4.3, Crypto 0.4.0, QRCode 0.0.1, **arduino-ctags 5.8 (Exuberant) compilé depuis les sources** (le ctags « Universal » 5.9 produit des prototypes faux pour tous les `__attribute__` et ne reproduit pas l'erreur). Les premières lignes de chaque journal (« Error initializing instance … library_index ») sont l'absence de réseau du cloud : sans effet sur la compilation. L'avertissement « Multiple libraries were found for Adafruit_GFX.h » vu chez le porteur vient de `Documents/Arduino/libraries/ssd1306` (sans effet).
