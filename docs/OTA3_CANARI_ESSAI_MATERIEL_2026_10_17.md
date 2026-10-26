# OTA-3 — premiers essais du canari automatique sur la carte (17/10/2026)

> Carte UNO R4 WiFi sur COM5 (module Wi-Fi 0.5.2), shield TFT retiré, réseau domestique 2,4 GHz. Niveaux : `[carte]` observé · `[code]` lu · `[hyp]` hypothèse. Journaux bruts (locaux, ignorés par git, contiennent des adresses privées) : `ota-lab/r4-ota3/runs/20261017-*/`. Verdict global : **3 PASS A → B → A consécutifs le 17/10/2026 (runs `20261017-113458`, `-115831`, `-120405`) À CONDITION DE FERMER le port série du PC pendant la reprogrammation ; avec le port ouvert, 3 essais sur 3 avaient échoué.**

## 1. Ce qui est maintenant établi `[carte]`

Run `20261017-110145` (commit `e5d1122`), jambe A → B, enchaînement automatique intégral :
- prévol (62 tests hôte), compilation de A et B, détection d'une seule carte, **téléversement de A par `arduino-cli upload`** (une fois), ouverture du port par le pont PowerShell ;
- identité de A (`hello`), **SHA-256 de la flash programme = `.bin` de A**, Wi-Fi + adresse IP non nulle, serveur vu par la carte (GET `/good.ota` reçu), `download = 76588`, `verify = 0`, `e`, **trois relectures complètes du fichier chez le module (75 lectures, ≈ 8,2 s chacune) avec `TICKET VALIDE`**, CRC de la flash de données relevés (`C57F71B4 E235286C 3F55D17F B83AFFF4 3D604A83`), `update_begin` ;
- 1 reprogrammation demandée, 0 retry.

## 2. Ce qui échoue `[carte]`

Dès `ota.update()` : le module écrit `E (…) uart: uart_get_buffered_data_len(1342): uart driver error`, le port série se ferme (`eof`) à +1,4 s, puis **plus aucune ligne, jamais** : 4 réouvertures du port (3 sur flux muet), `m` envoyé toutes les 3 s pendant 300 s, aucune identité → arrêt `timeout` (phase PROGRAMMING). La carte est restée muette ensuite (sonde de lecture : aucune réponse à `m` ni à `h`).

Diagnostic après coup : **`arduino-cli upload` de l'image B (mêmes octets que le `.ota`) fonctionne** (« Write 76588 bytes to flash »), et B répond aussitôt (`hello` build B, bon `run`, même identifiant de puce, **mêmes 5 CRC de data flash**, SHA-256 de la flash lisible). L'image B est donc saine ; c'est le chemin « module → BOSSA → redémarrage du RA4M1 » qui laisse la carte muette. Non établi : si la flash a été écrite (aucune lecture possible tant que la carte est muette), si le RA4M1 est resté en mode bootloader, ou si seule la liaison série a été perdue.

## 3. Défauts du banc trouvés et corrigés pendant ces essais

| Défaut | Cause | Correctif |
|---|---|---|
| réponses de la carte livrées avec une commande de retard | `[Console]::In.ReadLineAsync()` est SYNCHRONE dans Windows PowerShell 5.1 : le pont bloquait sur stdin | stdin lu en asynchrone (flux brut) ; test de régression |
| flux muet juste après un téléversement | descripteur de port périmé après réénumération USB | stabilisation 6 s, identité redemandée toutes les 3 s, réouverture du port en lecture seule (3 max) |
| « Wi-Fi CONNECTÉ » avec l'adresse `0.0.0.0` | bail DHCP en retard | la sonde attend une IP non nulle |
| `secrets.h` de la sonde d'un autre réseau | copie de l'ancien secrets.h du firmware de production (autre réseau) | identifiants du réseau actuel copiés depuis le secrets.h du firmware e-ink (ignoré par git) |
| verdict plantait sur le mot « secrets.h » | filtre trop large | filtre ciblé, écriture jamais fatale |

## 4. État de la carte

**État final au 17/10/2026 (après les trois PASS)** : la carte tourne la **build A** du canari (run `6F6B093B`, SHA-256 de la flash programme `433e367b…5fd5ba`, taille 76 628 o), flashée par le dernier retour B → A. (L'état « build B » décrit plus haut ne valait que pendant le diagnostic du 1ᵉʳ run.) **Le firmware de production du TFT 2,8″ n'est plus sur la carte** (remplacé dès le premier téléversement de A) ; le `secrets.h` de ce firmware correspond à l'ancien réseau.

## 5. Pistes pour la suite `[hyp]` (aucune n'a été testée)

1. Après `ota.update()`, le RA4M1 reste en bootloader (séquence de reset de BOSSA) : un appui sur RESET après l'échec le dirait.
2. Baud ou état de l'UART entre le module et le RA4M1 non restauré après BOSSA (`serial.begin(baud)`).
3. L'image n'est pas écrite (échec silencieux de BOSSA) : lisible seulement si la carte répond après un reset.
4. Témoin à faire : le **fichier OTA officiel d'Arduino** (exemple `OTA`) sur la même carte, pour savoir si la voie `OTAUpdate` complète fonctionne sur ce module 0.5.2 — nécessite un téléchargement de leur serveur, à autoriser.

## 6. PASS A → B → A (run `20261017-113458`, commit `4014c48`, option `--close-on-update`) `[carte]`

| Contrôle | Résultat |
|---|---|
| reprogrammations demandées / exécutées | 2 / 2 (A → B puis B → A), un seul `update_begin` par jambe, aucun retry |
| identité après la jambe 1 | build **B**, `run` 90F400AE, même identifiant de puce, preuve par « hello » (le boot a eu lieu pendant la fermeture du port) |
| SHA-256 de la flash programme après chaque reprogrammation | égal au `.bin` exact construit (B : `f7b179c0…`, A : `b7617462…`), 3 contrôles |
| flash de données (5 CRC de 8 Ko, dont le verrou de vote) | **identique** au départ, après B et après le retour en A |
| durée d'une reprogrammation | ≈ 50 s entre `update_begin` et la première identité (port fermé 45 s) |
| retour en A | build A, `run` 399A71DD, SHA-256 de la flash = `.bin` de A |

**Ce qui fait la différence `[carte]`** : avec le port série du PC OUVERT (pont PowerShell, DTR actif) pendant `ota.update()` : 3 essais, 3 échecs (carte muette ×2 ; ancienne image A de retour ×1, aucune écriture). Avec le port FERMÉ dès `update_begin` et rouvert 45 s plus tard : réussite (1 essai, 2 reprogrammations). **Hypothèse `[hyp]`** : l'hôte USB ouvert perturbe la liaison module ↔ RA4M1 pendant la séquence SAM-BA. **Constat factuel : sur cette carte et avec le module 0.5.2, la programmation BOSSA a échoué 3/3 lorsque le port série du PC restait ouvert et réussi 3/3 lorsqu'il était fermé. La cause exacte n'est pas démontrée. Toute OTA R4 doit donc imposer qu'aucun hôte ne maintienne le port série ouvert pendant la programmation.** Le banc ferme maintenant le port par défaut (`--keep-port-open` pour l'ancien comportement).

**Limites** : un seul PASS (n = 1) ; une seule carte ; HTTP en clair ; clés/identifiants de test ; aucun test de coupure de courant ; le module reste fragile (assertions après un `verify()` négatif). À faire avant d'en tirer une conclusion : ≥ 3 PASS consécutifs, puis la coupure de courant (autre GO).

## 7. Répétitions (17/10/2026, commit `2143a9d`, port PC fermé par défaut) `[carte]`

| Run | Verdict | Reprogrammations | Hash de la flash après chaque (3 contrôles) | Flash de données (5 CRC) | Identité après A → B / B → A |
|---|---|---|---|---|---|
| `20261017-113458` (option `--close-on-update`) | **PASS** | 2 / 2 | égal aux `.bin` | inchangée | B puis A, bons `run` |
| `20261017-115831` | **PASS** | 2 / 2 | égal aux `.bin` | inchangée | B (`D87665F0`) puis A (`82B7AB9E`) |
| `20261017-120405` | **PASS** | 2 / 2 | égal aux `.bin` | inchangée | B (`ED2774C5`) puis A (`6F6B093B`) |

**Trois PASS consécutifs sur la même carte, six reprogrammations (3 × A → B, 3 × B → A), zéro retry, flash de données identique à chaque fois (CRC de départ `C57F71B4 E235286C 3F55D17F B83AFFF4 3D604A83`).** À chaque run, des binaires neufs (nouveaux identifiants de run, téléversement initial de A par `arduino-cli`). Contre-épreuve : 0 réussite sur 3 avec le port PC ouvert pendant la reprogrammation. Verdicts archivés : `docs/mesures/OTA3_CANARI_2026_10_17/` ; journaux bruts (adresses privées) conservés localement, empreintes dans `SHA256_JOURNAUX_LOCAUX.txt`.

**Ce que cela établit** : la voie « module Wi-Fi → BOSSA » reprogramme correctement le RA4M1 de cette carte avec une image maison, de façon reproductible (3 / 3), sans toucher à la flash de données, À CONDITION qu'aucun hôte USB n'ait le port série ouvert pendant la séquence. **Ce que cela n'établit PAS** : sécurité (HTTP en clair, aucune signature : le CRC du `.ota` ne protège que de la corruption ; la vérification d'authenticité reste à faire par l'application, ticket + signature), coupure de courant, autre carte, TLS, firmware complet (TFT, vote), bootloader en cas d'image défectueuse. Seule affirmation publique : « OTA non généralisée ».
