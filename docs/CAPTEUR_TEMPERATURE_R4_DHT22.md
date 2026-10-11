# Capteur de température — UNO R4 WiFi + DHT22 (12/10/2026)

Objectif : une R4 qui envoie **une température par heure** à PoD, historique heure par heure dans « Mon profil » (carte de l'appareil → **🌡 Températures**). La R4 **ne calcule rien** (ni vote, ni validation, ni canari) : le chantier de consensus reprendra plus tard sur l'autre carte.

> ⚠ **Écrit dans une session cloud sans chaîne ARM : le sketch n'a JAMAIS été compilé pour la R4 ni essayé sur la carte.** Vérifié ici : syntaxe C++ contre des bouchons Arduino (clang), décodage DHT22 sur l'hôte, côté serveur/interface par `tsc`, ESLint et tests. Le réseau est la copie des blocs **validés sur carte** du firmware e-ink 2,9″ (canaris 09–10/10/2026), canari retiré.

## Mise en service

1. Câblage : DHT22 **VCC → 3,3 V**, **GND → GND**, **DATA → D2** (résistance de rappel 10 kΩ DATA↔3,3 V si le module n'en a pas ; les modules à 3 broches l'ont).
2. `arduino_uno_r4/pod_uno_r4_dht22/` : copier `secrets.h.example` en `secrets.h` (Wi-Fi 2,4 GHz, ignoré par git), bibliothèque **ArduinoJson** (la même que les autres firmwares), carte « Arduino UNO R4 WiFi », téléverser `pod_uno_r4_dht22.ino`.
3. Moniteur série (115200) : `[PAIR] Code d'appairage : XXXXXXXX`. Sur le site : **Mon profil → « + Ajouter un ESP »** (ou `/onboard`), saisir le code. L'appareil apparaît avec « Capteur température » ; la première mesure part dans la minute.
4. Carte de l'appareil → **🌡 Températures** : valeur actuelle, min / max / moyenne, courbe, tableau heure par heure (24 h / 7 jours / 31 jours).

Si la lecture échoue : `[DHT22] lecture impossible` (câblage D2, résistance de rappel, alimentation 3,3 V) ; nouvel essai toutes les 5 min.

## Fonctionnement

| Élément | Choix |
|---|---|
| Identité | `POST /api/register` avec `screens: ["sensor"]` (pas de clé, pas de vote). `sensor` n'est **pas** un écran |
| Mesure | `POST /api/sensor` `{deviceId, pairCode, c, h}` : `c` = dixièmes de °C (-400..800), `h` = dixièmes de % (0..1000). L'heure est celle du **serveur** (la carte n'a pas d'horloge) |
| Cadence | firmware : 1/heure (5 min après un échec). Serveur : refuse sans écrire toute mesure < 50 min après la précédente (`SET NX EX 3000`, 1 commande) |
| Exigences serveur | appareil connu, `pairCode` exact, capteur (`screens == ["sensor"]`), **appairé** à un profil |
| Stockage | liste Redis `sensor:t:{deviceId}` : `LPUSH` + `LTRIM 0 743` + `EXPIRE 40 j` (31 jours, ≈ 15 Ko) |
| Lecture | `GET /api/sensor?deviceId=…` réservée au **propriétaire** (cookie), 1 `LRANGE`, une seule lecture à l'ouverture du panneau (pas d'actualisation automatique) |

## Quota Redis (règle PRIMORDIALE)

Par capteur et par heure : limite IP 2 + lecture appareil 1 + anti-rafale 1 + `LPUSH/LTRIM/EXPIRE` 3 + présence 1 = **8 commandes/h ≈ 5 800 par mois** (≈ 3 % du plan de 200 k pour un capteur). Un redémarrage en boucle ne coûte qu'une commande utile (l'anti-rafale refuse le reste). Historique : 1 commande par ouverture du panneau.

## Garde-fous (testés dans `tests/sensor.test.ts`)

- **Quorum** : un capteur n'est **jamais** dans `devices:all` (sinon, apparié et « actif », il gonflerait `getGlobalActiveCount` / `getPoolSnapshot` et pourrait bloquer le minage), ni dans une pool d'écran, ni dans la vue réseau ; l'enregistrement n'invalide pas la vue réseau.
- Onboarding : un capteur renvoie vers `/profile`, pas vers une page de dessin.
- Interface : pas de « Dessiner / Animer » ni de réglages d'affichage pour un capteur.

## Limites

- Jamais compilé ARM ni flashé ; le **timing du DHT22** (mesure des impulsions par `micros()`, sans désactiver les interruptions) n'est validé nulle part : 3 tentatives par mesure, somme de contrôle obligatoire ; si ça échoue souvent, remplacer `dht22ReadOnce` par la bibliothèque Adafruit « DHT sensor library » (le reste est inchangé).
- Pas de pile du cœur R4 mesurée pour ce sketch : il n'utilise que des chemins validés (TLS/Wi-Fi/JSON sur piles dédiées), mais aucun relevé n'a été fait.
- Appairage : le code s'affiche **sur le moniteur série** (pas d'écran) ; code régénéré côté profil ⇒ la carte reçoit 403 et se ré-inscrit seule.
- Mesures horodatées à la **réception** (pas de rattrapage si le Wi-Fi tombe : une heure sans réseau = un trou).
- Aucune exposition publique des températures (lecture propriétaire uniquement).

## Rollback

`git revert` du commit : le dossier `arduino_uno_r4/pod_uno_r4_dht22/`, `/api/sensor`, le panneau et les garde-fous de `register`/`deviceStore`/`onboard` disparaissent. Les listes `sensor:t:*` expirent seules (40 jours).
