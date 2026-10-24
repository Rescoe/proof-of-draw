# Dépannage : première connexion, Wi-Fi, mises à jour

> Ce que l'utilisateur doit faire, **quand** il doit le faire, et quoi vérifier si ça ne marche pas. Valable pour les profils ESP8266 qui ont le portail Wi-Fi (TFT 1,8″, e-ink 2,9″ BWR, multiscreen 2,7″ + OLED). Pas encore installé ? [Choisir mon écran et installer](/learn?path=install#installer) · [Câbler](/learn?path=install#wiring) · [Firmware et Wi-Fi](/learn?path=install#firmware) · [Associer l’écran](/learn?path=install#onboard).
> Cette page est le rendu direct de `docs/DEPANNAGE_INSTALLATION.md` ; elle ne dit que ce qui a été observé ou documenté, et signale le reste comme non vérifié.

## Le parcours normal, dans l'ordre

1. **Brancher la carte** (après avoir [téléversé le firmware](/learn?path=install#configure)) sur un chargeur ou un port USB et **attendre**. Une carte e-ink met 15 à 45 secondes à dessiner un écran ; elle peut clignoter. Ne pas la débrancher pendant ce temps.
2. **Si la carte n'a pas (ou plus) de Wi-Fi enregistré**, elle ouvre son propre Wi-Fi nommé `PoD-XXXX` et affiche à l'écran son **mot de passe** (8 caractères, valable pour cette session). Le **nombre de QR dépend de l'écran** : l'e-ink 2,9″ BWR en affiche deux (rejoindre le Wi-Fi, ouvrir la page) ; le TFT 1,8″ et l'OLED du multiscreen en affichent un seul (rejoindre le Wi-Fi) avec l'adresse écrite.
3. **Avec un autre appareil que celui qui partage sa connexion** (si votre téléphone sert de box, utilisez un ordinateur ou un second téléphone) : scanner le **QR « rejoindre le Wi-Fi »** de l'écran, ou rejoindre `PoD-XXXX` à la main avec le mot de passe affiché.
4. Une page s'ouvre toute seule. **Sinon**, ouvrir le navigateur et taper `http://192.168.4.1`.
5. Choisir son Wi-Fi dans la liste (ou taper son nom exactement, majuscules et espaces compris), entrer le mot de passe, **Enregistrer**.
6. Quand la page dit « enregistré », **reconnecter son téléphone à sa box habituelle**. La carte redémarre seule (≈ 30 secondes). **Ne pas la débrancher.**
7. Elle se connecte, s'enregistre auprès du serveur et affiche son QR d'appairage si elle n'est pas encore liée à un profil. Une carte déjà appairée n'affiche pas de QR.

## Si la page de configuration ne s'ouvre pas ou refuse l'enregistrement

| Constat | Cause probable | Que faire |
|---|---|---|
| Le téléphone dit « pas d'Internet » et quitte le Wi-Fi `PoD-XXXX` | normal : ce Wi-Fi n'a pas d'accès Internet | accepter de **rester connecté** à ce réseau |
| La page ne s'ouvre pas seule | l'ouverture automatique dépend du téléphone et du navigateur (les navigateurs intégrés aux applications, comme Snapchat, la bloquent souvent) | ouvrir **Chrome ou Safari** et taper `http://192.168.4.1` |
| « Code 1 », « invalide » ou refus à l'envoi | le formulaire porte un jeton à usage limité ; il a expiré ou la page a été ouverte trop tôt | **recharger la page** (flèche circulaire) et recommencer tout de suite |
| Le réseau voulu n'est pas dans la liste | box éteinte, trop loin, ou diffusée **seulement en 5 GHz** : la carte ne voit que le **2,4 GHz** | rapprocher la carte, activer le 2,4 GHz de la box ; saisir le nom à la main si le réseau est masqué |
| L'écran de la carte n'a pas bougé après une minute | e-ink lente, ou carte déjà connectée à un réseau qu'elle connaît | patienter ; pour **forcer** le portail : débrancher, rebrancher, puis **2 à 3 secondes après la mise sous tension** maintenir le bouton **FLASH** pendant 2 secondes (la carte lit ce bouton seulement quand elle essaie de se connecter) |
| Le mot de passe est refusé | mauvaise saisie (clavier, majuscules), ou box en WPA3 seul (l'ESP8266 ne gère que le WPA2) | utiliser l'œil « afficher » du formulaire pour vérifier ; essayer en WPA2 |
| Le portail se ferme tout seul | il reste ouvert **5 minutes** quand la carte a déjà un Wi-Fi enregistré qui est injoignable ; elle réessaie ensuite | attendre qu'il se rouvre, ou le forcer avec le bouton **FLASH** (voir la ligne précédente) |

⚠ **Ne jamais maintenir le bouton FLASH enfoncé quand on branche la carte** : cela la met en mode téléchargement et elle n'affiche plus rien.

## Après un déménagement ou un changement de box

La carte garde son ancien Wi-Fi. Au démarrage chez soi, si ce réseau n'existe pas, elle ouvre le portail au bout d'environ **20 secondes** d'essai et le garde ouvert 5 minutes, avec une reconnexion en arrière-plan. Si le réseau revient, elle repart seule ; sinon elle redémarre et rouvre le portail. Rien à effacer.

*Non vérifié sur le BWR e-ink 2,9″ : le passage « échec de connexion → portail » a été observé sur le multiscreen, pas encore sur un BWR chez un tiers.*

## Retrouver l'accès à un écran déjà appairé

À lire aussi : [Associer l’écran](/learn?path=install#onboard).

Le profil d'un écran est lié à son code d'appairage. Si le navigateur qui l'avait appairé est perdu (ouvert dans une application comme Snapchat, nouveau téléphone, cookie effacé), **ouvrir** `https://proof-of-draw.vercel.app/onboard?code=<CODE>` **dans Chrome ou Safari**, avec le code affiché sur l'écran de la carte ou donné par le propriétaire. Aucune réinitialisation n'est nécessaire. Pour donner l'accès à un autre ordinateur : « Autoriser un autre équipement » dans le profil.

## Mises à jour à distance (OTA) : ce qu'on peut en attendre

- La carte reçoit une annonce au prochain contact avec le serveur (de 5 à 15 minutes). Elle télécharge et redémarre seule ; **ne pas la débrancher** pendant ce temps.
- Si **rien ne change**, c'est que la carte a refusé ou échoué (mémoire, horloge, vote en cours). L'ancienne version continue de fonctionner. Un redémarrage manuel de la carte relance une tentative.
- Les profils avec marge mémoire très faible peuvent échouer : voir la page [Compatibilité matérielle](/learn#compatibilite).
- Récupération par câble USB : toujours possible.

## Branchements qui piègent

- **DHT22 sur D3 (GPIO0)** : le débrancher pour téléverser par câble USB ; le rebrancher ensuite. Il ne gêne pas le démarrage normal.
- **Alimentation 3,3 V uniquement** pour les écrans et capteurs ; jamais 5 V.
- **COM inaccessible dans l'IDE Arduino / téléversement refusé** : fermer tout moniteur série (l'IDE ou un autre programme) ; si le port reste « occupé », débrancher et rebrancher le câble, puis redémarrer l'ordinateur en dernier recours.
- **OLED + e-ink 2,9″ BWR** : l'OLED du BWR empêche le téléchargement des œuvres (mémoire) et n'est pas proposé : voir la [matrice de compatibilité](/learn#compatibilite).

## Si rien ne marche

Noter ce que l'écran de la carte affiche (photo), le message exact du téléphone, la version du firmware (visible sur la carte de l'appareil dans « Mon profil »), puis le signaler avec ces trois éléments : c'est ce qui permet de diagnostiquer à distance, car la carte n'envoie pas de journal au serveur.
