# Affichages récurrents sur e-ink : durée de vie, budgets, conception (température, trajet TomTom…) — 25/10/2026

Statut : **étude chiffrée + conception, rien n'est construit** (sauf la température gravée sur le BWR, déjà dans le firmware, avec seuils). Les chiffres de durée de vie sont des **ordres de grandeur** fondés sur la documentation du fabricant du module ; la durée réelle d'un panneau n'est pas garantie.

## 1. Ce que dit la documentation (sources)
Module Waveshare 2.9″ e-Paper (B), tri-color, [manuel](https://www.waveshare.com/wiki/2.9inch_e-Paper_Module_(B)_Manual) :
- intervalle entre deux rafraîchissements : « au moins **180 s** » ; rafraîchir « au moins **une fois toutes les 24 heures** » ;
- après un rafraîchissement, **mettre l'écran en veille** ou le couper : le laisser alimenté longtemps (haute tension) « *will damage the e-Paper and cannot be repaired* » (le firmware appelle `epd.Sleep()` après chaque rafraîchissement) ;
- rafraîchissement complet : **≈ 14 s** (mesure du fabricant) ; la version V4 propose un rafraîchissement **partiel noir et blanc**, mais il faut un rafraîchissement complet après plusieurs partiels (artefacts durables sinon) ;
- FAQ : « avec un usage normal, **1 000 000 de rafraîchissements** » (idéalement) ;
- couleur : l'encre rouge/jaune varie d'un lot à l'autre (normal) ; stocker l'écran face vers le haut.

Autres sources : [guide Adafruit](https://learn.adafruit.com/adafruit-1-54-eink-display-breakouts/usage-expectations) (limite des 3 minutes ; sur les écrans tri-color le fond peut **rosir** avec le temps) ; des retours de la communauté citent des valeurs prudentes autour de **100 000** rafraîchissements (anecdotique, non spécifié).

## 2. Durée de vie estimée selon la fréquence
Hypothèses : 10 œuvres affichées par jour (chacune = 2 rafraîchissements : blanc puis image) = **20 rafraîchissements/jour** en plus de la mesure ; deux bornes : **1 000 000** (FAQ du fabricant, « idéal ») et **100 000** (prudent, anecdotique).

| Intervalle de rafraîchissement de la mesure | Rafr./jour (mesure) | Total avec œuvres | Par an | Années à 1 000 000 | Années à 100 000 |
|---|---|---|---|---|---|
| 180 s (minimum Waveshare) | 480 | 500 | 182 500 | 5,5 | 0,5 |
| 5 min | 288 | 308 | 112 420 | 8,9 | 0,9 |
| 10 min | 144 | 164 | 59 860 | 16,7 | 1,7 |
| 15 min | 96 | 116 | 42 340 | 23,6 | 2,4 |
| **30 min** | 48 | 68 | 24 820 | **40,3** | **4,0** |
| **1 h** | 24 | 44 | 16 060 | **62,3** | **6,2** |
| 2 h | 12 | 32 | 11 680 | 85,6 | 8,6 |
| 4 h | 6 | 26 | 9 490 | 105,4 | 10,5 |
| **30 min avec seuils (≈ 8 rafr./jour de mesure)** | ≈ 8 | ≈ 28 | 10 220 | **97,8** | **9,8** |

Lecture : **toutes les 30 minutes** reste raisonnable (≈ 4 ans dans l'hypothèse prudente, plusieurs dizaines d'années dans celle du fabricant) ; **toutes les heures** est confortable ; en dessous de 15 minutes l'hypothèse prudente devient courte. Ces durées ne comptent que l'usure en nombre de rafraîchissements : le rosissement du fond tri-color, la chaleur ou les chocs ne sont pas modélisés.

## 3. Ce que fait déjà le firmware BWR (température gravée)
- lecture du DHT22 toutes les 30 minutes, **mais rafraîchissement e-ink seulement si la mesure affichée a changé de façon utile** : température ≥ 0,5 °C ou humidité ≥ 3 % par rapport à ce qui est gravé, **ou** gravure de plus de 3 h (constantes `POD_ENV_MIN_DT10`, `POD_ENV_MIN_DH10`, `POD_ENV_MAX_AGE_MS`) ; sinon une ligne `[ENV] mesure peu changee … pas de rafraichissement e-ink` ;
- un seul rafraîchissement par mise à jour (pas de blanc préalable), depuis la dernière frame sauvegardée en flash (aucune requête réseau) ;
- 180 s minimum entre deux rafraîchissements (garanti par le pilote), mise en veille après chaque rafraîchissement, et chaque œuvre nouvelle rafraîchit l'écran.
- **Limite connue** : tant que le capteur lit, l'écran est régravé au moins toutes les 3 heures (écart maximal), ce qui respecte « au moins une fois par 24 h ». Si le capteur est débranché ou en panne **et** qu'aucune œuvre n'arrive, rien ne rafraîchit l'écran : le rafraîchissement quotidien forcé recommandé par le fabricant **n'existe pas encore** (à ajouter, notamment pour un futur widget).

## 4. Pistes pour économiser l'écran (non faites)
1. **Rafraîchissement partiel noir** de la seule zone « mesure » (le module V4 le permet) : pas de clignotement, ≈ 1 à 2 s, usure bien moindre ; un complet toutes les N mises à jour et au moins une fois par jour. Le rouge disparaîtrait de la zone mesure (partiel = noir et blanc seulement).
2. **Rafraîchissement quotidien forcé** si rien n'a changé depuis 24 h.
3. **Fenêtres horaires** (par exemple pas de mise à jour la nuit pour une mesure).

## 5. Extension « affichage récurrent » choisi par l'utilisateur (ex. temps de trajet TomTom)
### Principe
Un « widget » est un court texte (ou une valeur) mis à jour à intervalle régulier et gravé dans une zone réservée du cartel, comme la température. Le serveur calcule la valeur ; la carte ne reçoit que quelques octets et réutilise le mécanisme de gravure (aucune image à retélécharger : la dernière œuvre est gardée en flash).

### Budget TomTom
- Offre gratuite : **2 500 requêtes non-tuile par jour** (compte Freemium, [tarifs TomTom](https://docs.tomtom.com/pricing)) ; au-delà : refus (HTTP 403 selon un guide tiers) ou payant. **À vérifier avant tout lancement** : conditions d'utilisation, attribution, tarif actuel.
- Chaque **trajet distinct** coûte une requête par rafraîchissement du cache. Avec un cache partagé côté serveur (même trajet = une seule requête) :

| Cache | Fenêtre d'appel | Requêtes/jour/trajet | Trajets distincts maximum (2 500/j) |
|---|---|---|---|
| 30 min | 24 h | 48 | 52 |
| 15 min | 24 h | 96 | 26 |
| 15 min | 8 h (par exemple 6 h–10 h et 16 h–20 h) | 32 | 78 |
| 10 min | 8 h | 48 | 52 |
| 30 min | 8 h | 16 | 156 |

Conclusion : environ **50 à 150 trajets** tiennent dans l'offre gratuite avec des fenêtres horaires ; au-delà il faut un plan payant ou limiter le nombre de widgets par profil.

### Budget Redis (règle PRIMORDIALE du projet)
Une mise à jour toutes les 30 minutes par appareil ≈ 1 440 mises à jour/mois × ≈ 4 commandes (lecture du cache, éventuel remplissage, lecture de l'appareil, limite de débit) ≈ **5 800 commandes/mois/appareil**, du même ordre que le capteur. Sur un plan de 200 000 commandes/mois, environ **30 appareils** avec un widget toutes les 30 min en plus du reste : **à planifier avec le plan Redis** avant d'ouvrir la fonction.

### Données personnelles et sécurité
- Les adresses domicile et travail sont des données sensibles : ne stocker côté serveur que des **coordonnées arrondies** ou un identifiant de trajet, jamais l'adresse en clair dans les journaux ; les limiter au profil propriétaire.
- **La clé TomTom ne quitte jamais le serveur** (aucune clé dans le firmware, la page ou un journal).
- Limite de débit par profil et par appareil, plafond de widgets par profil, intervalle minimal de 30 minutes, fenêtres horaires configurables.

### Conception proposée
1. Réglage dans le profil de l'appareil : type de widget (température locale, trajet, météo…), paramètres (trajet : origine et destination géocodées côté serveur), fenêtres et intervalle (≥ 30 min), ligne de cartel utilisée.
2. Le serveur calcule et met en cache ; `/api/pull` annonce un champ `widget` court (≤ 64 octets) seulement quand la valeur affichée doit changer (mêmes seuils que la température : on ne rafraîchit que si le texte change).
3. Le firmware grave le texte comme la température (mêmes fonctions), avec la limite de 180 s et le rafraîchissement quotidien.
4. Visibilité dans l'interface : le menu du widget n'apparaît que si le firmware **déclare** la capacité (comme les capteurs) ET qu'une valeur a été reçue.
5. Matrice de compatibilité : une ligne par famille (le BWR e-ink peut graver un widget ; l'OLED, le TFT et les autres écrans ont d'autres surfaces d'affichage).

### Limites
Un e-ink tri-color à 14 s par rafraîchissement n'est pas adapté à un affichage « temps réel » : 30 minutes est un plancher raisonnable, 1 heure confortable. Les écrans TFT et OLED (sans usure de ce type) conviendraient mieux aux widgets fréquents.
