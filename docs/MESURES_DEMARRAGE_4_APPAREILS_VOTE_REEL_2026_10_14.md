# Premier démarrage des 4 appareils au firmware « vote réel » — relevé (14/10/2026, ~15h14 – 15h53)

Sources : journaux série des 4 appareils (transmis par le porteur) et export `redis-monitor.csv` (Upstash, 321 commandes en 39 min). **Le CSV brut n'est pas archivé** (il contient adresses IP, adresses MAC et codes d'appairage) ; seule cette synthèse l'est. **Aucun candidat ni aucun vote dans cette fenêtre** : pas de `SET candidate:current`, pas de vote dans le journal Redis. Ce relevé valide le démarrage, pas encore le vote.

## 1. Les 4 appareils démarrent et sont reconnus
| Appareil | `deviceId` | Firmware vu côté serveur | Constaté |
|---|---|---|---|
| UNO R4 + TFT 2,8″ | `dev_7B4L17N3` | `r4tft28-2.5` | clés chargées, auto-test Ed25519 OK (signature 177 ms), `register` 200 appairé, dernière œuvre réaffichée depuis la SD (911 ms), premier pull 200 (« nouveau bloc #99 », aucune frame), `[BOOT] prêt` |
| ESP8266 e-ink 2,9″ BWR | `dev_MN67OG7R` | **`eink29bwr-2.3`** | déjà appairé, pull 200, frame personnelle 9 472 o reçue, affichée, ACK 200 ; heap après 32 984 o (plus gros bloc 26 648 o) |
| UNO R4 + e-ink 2,9″ BWR | `dev_W29I1TW7` | `r4eink29-1.1` | frame personnelle reçue (noir 4 736 + rouge 4 736), affichée en 14,4 s, ACK 200, tas 8 300 o |
| ESP8266 multiscreen (e-ink 2,7″ + OLED) | `dev_KAD6PKC4` | `multiscreen-2.5` | frame consensus #99 reçue (5 808 o via flash), affichée après l'attente minimale entre rafraîchissements (≈ 168 s), ACK 200 `cleared:true`, animation OLED reprise (9 images) |
**Les quatre chaînes de version sont bien dans la liste `VOTE_V2_FIRMWARE`** : ces appareils resteront actifs après la fusion dans `main`.

## 2. Ce que montre le journal Redis
- Bloc **#99** (miné plus tôt par l'appareil d'un ami, voir la note du lot) propagé : image `082936dd…` affichée sur l'e-ink 2,9″ (15h40) et sur l'e-ink 2,7″ (15h52), restaurée sur la TFT par la SD.
- Écritures de présence espacées (≈ 1 par appareil toutes les 12 min), pulls ≈ 1 commande de lecture : le budget Redis est respecté. ~320 commandes en 39 min pour ~8 appareils.
- Redémarrages visibles (plusieurs `register` successifs de `dev_W29I1TW7` et `dev_KAD6PKC4`) : reflashs et resets du porteur.

## 3. Autres appareils vus sur la production (à identifier par le porteur)
| `deviceId` | Ce qu'on voit | Conséquence à la fusion |
|---|---|---|
| `dev_T46HBXG1` | e-ink 2,9″ au firmware **`2.0`** (nu), artiste « Claude » ; tire régulièrement | **coupé** (ancien firmware) — probablement l'appareil de l'ami |
| `dev_HF615EF9`, `dev_7GUJIOCM` | uniquement des lectures de pull (firmware inconnu dans cette fenêtre) | coupés s'ils ne déclarent pas un firmware de la liste ; **à vérifier** |
| `dev_I25D9Z7A` | capteur (DHT22), envoie ses mesures | hors mécanisme (jamais exclu, jamais compté) |
**Conséquence pour le quorum AVANT la fusion** (ancien serveur) : tout appareil appairé actif depuis moins de 45 min compte, capable ou non ; avec 7 appareils il faudrait 4 votes (`ceil(0,51 × 7)`), donc les 4 appareils du porteur devraient tous voter. **Après la fusion** : seuls les 4 capables comptent (3 votes suffisent, dont au moins 1 v2).

## 4. Deux comportements observés (sans lien avec le vote)
1. **Frames personnelles revues après un redémarrage** : l'ACK d'une frame personnelle répond `cleared:false` ; l'appareil ne mémorise pas son dernier `frameId` au redémarrage et retélécharge la frame personnelle encore présente (ESP 2,9″ : écran rafraîchi avec la même image ; R4 e-ink 2,9″ : ancienne œuvre personnelle réaffichée après un Reset). Comportement connu de la frame personnelle, à traiter dans un lot d'affichage.
2. **ESP 2,9″ BWR : `e-Paper busy TIMEOUT` ×3** pendant le rafraîchissement, l'image s'affiche malgré tout puis l'ACK part. Pilote d'écran (attente BUSY) ; à surveiller, hors vote.

## 5. À regarder dans les prochains journaux (envoi d'un nouveau dessin)
- Dans Redis : `SET candidate:current`, puis les écritures de `candidate:votes` (script `EVAL`) à chaque vote, et la création du bloc.
- Sur chaque appareil : `[VALIDATE…]`/`[VALIDATE2]`, lecture du candidat, `vote envoyé` (ou l'erreur : 403 signature, 422 métriques). Dans l'app : `v2 vérifié×N` avec N ≥ 1.

## 6. PREMIER CONSENSUS v2 SUR MATÉRIEL (journal Redis, 15h56 – 16h04) — résultat positif
Candidat « Vote fleur » dessiné sur l'OLED du multiscreen (`dev_KAD6PKC4`), écran `oled096`, contenu brut 1 024 o, spécification v2 du serveur : entropie 906 828, transitions 103 446, RLE 323 818, score 468 873 (ppm). `poolSize = 3` ⇒ quorum **2** (`ceil(0,51 × 3)`).
| Heure | Événement |
|---|---|
| 15:56:52 | `SET candidate:current` (candidat v2) et `candidate:votes` vide |
| 15:57:34 | **vote v2 du R4 e-ink 2,9″** (`dev_W29I1TW7`, 42 s après le candidat) : `v:2`, `verdict:accept`, entropie / transitions / RLE / score **identiques à ceux du serveur**, signature présente |
| 16:01:32 | **vote v2 du TFT 2,8″** (`dev_7B4L17N3`) : mêmes métriques exactes, signature présente ⇒ quorum atteint |
| 16:01:33 | **bloc #100 miné** (`minerDeviceId` = TFT, `validatorIds` = TFT + R4 e-ink 2,9″), `parentHash` = bloc #99 ; image, actions, rejeu et chaîne écrits ; réobservation de 5 blocs mise en file (`chain:obs:queue`) |
| 16:01:33 – 35 | frame du bloc diffusée aux écrans des pools : e-ink 2,9″ ×3, e-ink 2,7″, TFT 1,8″, TFT 2,8″, OLED ×5 ; `candidate:current` / `votes` supprimés ; images personnelles des OLED effacées |
**Deux appareils de deux familles différentes (R4 e-ink 2,9″ et R4 TFT 2,8″) ont chacun recalculé de leur côté, sur 1 024 octets reçus, exactement les mêmes entiers que le serveur, les ont signés, et le serveur a miné le bloc.** C'est le premier vote v2 vérifié sur matériel.
**Pas encore démontré** : (1) aucun vote d'un **ESP8266** (`dev_MN67OG7R` n'a tiré qu'après la création du bloc, `dev_KAD6PKC4` est l'auteur) ; (2) la validité cryptographique stricte n'est pas observable dans Redis (à lire dans les logs Vercel / le fil d'activité `v2 vérifié×N`) ; (3) le TFT a voté ≈ 2 min 40 s après avoir vu le candidat (cause à lire dans son journal série) ; (4) réception de la frame sur l'OLED en cours au moment du relevé. D'autres appareils (`dev_WZ0U0514`, `dev_VIRBQRV1`, `dev_V0VR30AY`, `dev_9MN414IJ`, `dev_R8Q69GOH`, `dev_YIALM6LG`, `dev_0HWXIKJM`, `dev_HF615EF9`) sont dans les pools : à classer (à eux / ami, firmware) avant la fusion.
