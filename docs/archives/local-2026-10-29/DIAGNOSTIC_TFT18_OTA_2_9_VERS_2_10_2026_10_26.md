# Diagnostic OTA TFT 1,8″ — `tft18-2.9` vers `tft18-2.10`

Date d'ouverture : 26/10/2026, 19:05 (Europe/Paris)
Appareil ciblé : `dev_VIRBQRV1`
Statut : **diagnostic en cours ; aucune écriture sur la carte, aucun flash, aucun déploiement**.

## Symptôme rapporté

- La carte continue de s'enregistrer comme `tft18-2.9`.
- Les journaux Vercel montrent un `pull` environ toutes les quinze minutes.
- Aucun téléchargement de firmware ni redémarrage sur `tft18-2.10` n'a été observé.
- Le DHT22 branché sur D3 reste donc indisponible : son code n'est activé que dans la cible `tft18-2.10`.

## Faits vérifiés hors matériel

1. La version installée attendue `tft18-2.9` est le build générique à portail et client OTA, séquence 6 (`PORTAL-BUILD-PIN.json`, SHA-256 `f9eb8e74…`).
2. La release `ota-releases/tft18-2.10-ota7/` est présente sur `origin/main` depuis le commit `394e64a`.
3. Son manifeste cible exclusivement `dev_VIRBQRV1`, famille `esp8266-tft18`, canal `canary`, version `tft18-2.10`, séquence 7.
4. La région signée fait 616 432 octets. Le fichier servi fait 616 692 octets : les 260 octets supplémentaires correspondent au trailer attendu (signature RSA 256 octets + longueur 4 octets), ce n'est pas une divergence de taille.
5. Le serveur considère `tft18-2.9` compatible OTA (minimum `tft18-2.7`). Une carte en séquence 6 doit donc être éligible à la séquence 7 si :
   - `OTA_DIST_MODE=on` ;
   - `OTA_TICKET_SECRET` et les clés publiques de publication sont disponibles ;
   - `ota:kill` est absent ;
   - la fiche Redis de l'appareil contient sa clé publique ;
   - la release est chargée et vérifiée par le registre.
6. La documentation antérieure classait déjà cette variante **EXP** : release annoncée/préparée, mais installation jamais observée et aucun journal série conservé.

## Hypothèses encore ouvertes

1. **Aucune annonce envoyée** : kill-switch, variable de distribution, clé publique de l'appareil ou release ignorée.
2. **Annonce reçue puis refusée avant téléchargement** : mémoire fragmentée, tas, pile de signature, heure SNTP ou billet expiré.
3. **Téléchargement commencé puis échoué** : TLS/mémoire ou refus du fichier ; cette hypothèse devrait produire une requête `/firmware/...` dans les journaux Vercel.
4. **Build réel différent du build épinglé** : à exclure par la bannière série et, si nécessaire seulement, par une lecture de flash.

## Mesure suivante, sans écriture

Brancher la carte avec TFT et DHT22, fermer tout moniteur Arduino, puis capturer à 115200 bauds :

- la bannière de démarrage (`firmware`, séquence et état OTA) ;
- un `/api/register` et un `/api/pull` ;
- toutes les lignes `[OTA]` ;
- le tas libre et le plus grand bloc avant/après le pull.

La première bifurcation du diagnostic est simple :

- aucune ligne « annonce acceptée/refusée » après le pull → cause serveur/éligibilité ;
- annonce acceptée suivie d'un report → cause locale explicitée par la ligne `[OTA]` ;
- requête firmware puis échec → diagnostiquer le code HTTP, BearSSL et la mémoire.
