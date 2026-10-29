# OTA — consentement explicite du propriétaire (piste de sécurité à planifier)

Date : 23/10/2026
Statut : décision d'architecture différée, non implémentée. Elle ne bloque pas les releases OTA actuellement signées.

## Contexte acquis

Les canaris OTA Internet ESP8266 TFT 1,8″ et e-ink 2,9″ BWR ont démontré qu'un appareil déjà équipé du client OTA peut recevoir un firmware signé, ciblé et vérifié, sans câble. Les protections déjà en place sont : TLS authentifié, signature de la release, identité cryptographique de l'appareil, ciblage de la release, compteur de tentatives et interrupteur global `ota:kill`.

Ces protections empêchent une image arbitraire d'être installée. Elles ne remplacent toutefois pas une politique décidée par le propriétaire de l'appareil : une release valide, publiée par l'opérateur, peut aujourd'hui être proposée au client autorisé sans action préalable de son propriétaire.

## Objectif différé

Ajouter une politique de mise à jour choisie dans l'application PoD, puis appliquée localement par l'appareil :

- **manuel** : aucune installation sans accord explicite depuis l'application ;
- **correctifs de sécurité** : installations automatiques seulement pour une classe de release explicitement définie ;
- **automatique** : comportement actuel, mais visible et révocable ;
- **désactivé** : l'appareil ne consulte ou n'accepte aucune offre OTA.

Pour le mode manuel, l'utilisateur verrait une mise à jour disponible dans l'application, puis cliquerait sur « Autoriser cette mise à jour ». Le serveur produirait alors une autorisation courte, liée à *un appareil*, *une release* et *une expiration*. L'ESP vérifierait cette autorisation avant de télécharger ou d'activer l'image.

## Pourquoi ce lot peut être ajouté après le déploiement actuel

Le firmware déjà diffusé possède le mécanisme OTA signé. Il peut donc recevoir une future release qui introduit cette politique, sans reflash par câble. C'est le chemin pragmatique retenu afin de ne pas retarder la diffusion des firmwares TFT 1,8″ et BWR déjà validés.

Limite importante : avant l'installation de cette future release, la sécurité reste celle du client actuel. En particulier, une compromission de la clé de signature ou de l'infrastructure de distribution ne peut pas être réparée rétroactivement par une autorisation distribuée par cette même infrastructure.

## Exigences du futur lot

1. Conserver les invariants existants : signature de release, TLS, ciblage, compteur de tentatives, `ota:kill`, refus fermé.
2. Ne pas considérer un clic web seul comme une autorisation suffisante : le jeton doit être signé ou MACé côté serveur, borné dans le temps et attaché au `deviceId`, à l'identifiant/version/empreinte de release et à la politique demandée.
3. Persister la politique locale dans la zone de configuration existante, avec valeur par défaut explicite et migration compatible.
4. Prévoir la révocation : le propriétaire peut repasser en manuel ou désactivé ; le kill switch global reste prioritaire.
5. Ne jamais donner au client un secret de signature serveur. L'appareil ne conserve que les clés publiques ou éléments de vérification nécessaires.
6. Tester les cas : offre sans consentement, consentement expiré, consentement destiné à un autre appareil, nouvelle release avec même nom mais autre empreinte, coupure réseau, redémarrage et refus utilisateur.
7. Mesurer RAM/flash sur chaque famille avant généralisation. Le TFT 1,8″ a une marge OTA faible ; toute logique doit rester compacte et inactive hors cycle OTA.

## Ordre recommandé

1. Stabiliser et publier les clients actuellement validés (TFT 1,8″ et BWR 2,9″).
2. Porter les familles suivantes et leur première connexion, sans changer le contrat OTA déjà validé.
3. Réaliser le lot « politique de mise à jour / consentement propriétaire » avec un canari ciblé.
4. Seulement après preuve matérielle, en faire la politique par défaut pour les nouveaux appareils destinés à des tiers.

## Extension fonctionnelle envisagée

Un même appareil cible pourra ultérieurement combiner e-ink, OLED, DHT22, vote V2 et OTA. Une release signée et strictement ciblée à son `deviceId` pourra ajouter ces capacités. Un appareil sans client OTA doit néanmoins toujours recevoir un premier firmware compatible par câble.
