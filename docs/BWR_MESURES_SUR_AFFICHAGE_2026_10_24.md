# BWR 2,9″ : température et humidité gravées sur l'œuvre, rafraîchies toutes les 30 min (24/10/2026)

Statut : **EXPÉRIMENTAL, compilé et testé statiquement ; jamais flashé ni vu sur le panneau.** Cible d'essai : `dev_MN67OG7R` (BWR du porteur). Option `POD_SENSOR_DISPLAY` (0 par défaut ; exige `POD_SENSOR_DHT22` et `POD_WIFI_PORTAL`) : sketch identique à avant à 0 (test `wifiBwrFirmware`).

## Comportement
- Le DHT22 (D3) est lu toutes les 30 min (première lecture 20 s après le démarrage). À chaque lecture valide, la mesure est formatée (« 21.4C 72% ») et **gravée EN ROUGE dans la bande haute du cartel**, à droite ; la date et le numéro de bloc restent à gauche (tronqués si besoin).
- L'écran est **rafraîchi à chaque lecture valide** depuis la dernière frame sauvegardée : **aucun téléchargement, aucune requête serveur, 0 commande Redis**. Un seul rafraîchissement e-ink (15 à 45 s, 180 s minimum entre deux, pas de blanc préalable ⇒ un léger fantôme est possible ; la frame de l'œuvre suivante repasse par le chemin normal avec blanc).
- Une mesure de plus de 2 h n'est plus affichée. Une frame nouvelle grave la dernière mesure connue dès son affichage.
- L'envoi à `/api/sensor` reste horaire (comme les autres cartes) ; le menu « Mesures » de PoD apparaît après la première mesure reçue.

## Sauvegarde de la frame (pour redessiner sans réseau)
Avant la gravure du cartel, les plans PROPRES (noir + rouge, 2 × 4 736 o) et les textes du cartel sont écrits en **flash brute** : 3 secteurs de 4 Ko à `0x3F0000` (partition de fichiers 2 Mo de `eesz=4M2M`, inutilisée par ce firmware ; ni EEPROM `0x3FB000` ni Wi-Fi système). En-tête de 256 o écrit **en dernier**. Un effacement de 3 secteurs par frame affichée. Choix de la flash brute : LittleFS coûtait +548 o de RAM statique et +29 Ko de flash (le tas contigu pendant le téléchargement d'une frame est déjà juste : voir `BWR_HYBRIDE_OLED_DHT22_ONBOARD_2026_10_24.md`). RAM statique du build : 37 244 o (+ 40 o par rapport au DHT22 seul), binaire 532 128 o.

## À savoir
- Pas d'OLED dans ce build (il casse le téléchargement des frames).
- Si aucune frame n'a encore été affichée depuis le démarrage, le rafraîchissement de mesure n'a pas lieu (le chemin normal grave la mesure à l'affichage de la première frame).
- Usure : jusqu'à 48 rafraîchissements par jour en plus des frames (spécification Waveshare : 180 s minimum, au moins un par jour).
- Orientation du texte : mêmes fonctions que le cartel existant ; le glyphe « % » (absent de la police) suit la convention de la police (bit 0 = ligne du haut visuelle sur ce panneau, voir le glyphe « / »). **À vérifier à l'œil au premier essai.**
- Tests : `tests/bwrSensorDisplay.test.ts` (statique : zone flash, ordre sauvegarde → gravure, en-tête en dernier, tient dans la bande).
