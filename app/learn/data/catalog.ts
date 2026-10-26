// app/learn/data/catalog.ts — catalogue des sujets de la page « Apprendre » (recherche, filtres, intentions).
//
// RÈGLE : rien ne se supprime. Une section qui existe dans le rendu a ici une entrée ; `tests/learnCatalog.test.ts` compare les ancres trouvées dans les composants à ce fichier.
// Deux axes indépendants : PROFONDEUR (decouvrir / pratiquer / comprendre) et TYPE (guide / concept / depannage / reference / etat). `keywords` = ce qu'un débutant tape sans connaître le mot juste.
// Les sections des documents markdown (matrice, dépannage) et les phases de la feuille de route sont ajoutées par `buildCatalog()` (app/learn/catalogBuild.ts), à partir de leur contenu.

import type { CatalogEntry, Depth, Kind, LearnPath } from "../../../lib/learnCatalog";

const e = (path: LearnPath, anchor: string, title: string, summary: string, kind: Kind, depth: Depth, keywords: string[] = []): CatalogEntry =>
  ({ id: `${path}:${anchor}`, path, anchor, title, summary, kind, depth, keywords });

/** Ordre = ordre d'affichage quand on ne cherche rien (du plus accessible au plus technique, parcours par parcours). */
export const STATIC_CATALOG: CatalogEntry[] = [
  // ── Participer sans matériel ───────────────────────────────────────────────
  e("no-esp", "no-esp", "Participer sans ESP", "Dessiner sur un écran partagé, consulter les œuvres et découvrir les artistes sans posséder de matériel.", "guide", "decouvrir",
    ["sans matériel", "sans carte", "gratuit", "débuter", "commencer", "écran partagé", "prêt public", "dessiner", "invité"]),

  // ── Installer un écran ─────────────────────────────────────────────────────
  e("install", "installer", "Installer un écran : vue d’ensemble", "Le choix du matériel pilote tout le guide : câblage, bibliothèques et firmware suivent la variante choisie.", "guide", "pratiquer",
    ["installation", "monter", "brancher", "construire", "fabriquer", "tutoriel", "débutant", "esp8266", "uno r4"]),
  e("install", "install-step-1", "Choisir l’écran et la carte", "Quel écran (e-ink, OLED, TFT) avec quelle carte (ESP8266 ou UNO R4 WiFi), et ce que chaque combinaison sait faire.", "guide", "pratiquer",
    ["matériel", "acheter", "liste de courses", "e-ink", "oled", "tft", "bwr", "2,9", "2,7", "1,8", "2,8", "choisir", "compatible"]),
  e("install", "i-quel-ecran", "Je ne sais pas quel écran j’ai", "Reconnaître son écran à sa taille, ses couleurs et la référence imprimée au dos.", "guide", "decouvrir",
    ["identifier", "référence", "reconnaître", "quel modèle", "quel écran", "dos de l’écran"]),
  e("install", "install-step-2", "Préparer le matériel", "Ce qu’il faut avoir sous la main : carte, écran, câbles, alimentation USB.", "guide", "pratiquer",
    ["câble usb", "alimentation", "fils", "dupont", "outils", "souder", "breadboard"]),
  e("install", "wiring", "Câbler l’écran à la carte", "Schéma de branchement et correspondance des broches pour la variante choisie.", "guide", "pratiquer",
    ["câblage", "branchement", "brancher", "broches", "pins", "schéma", "fils", "spi", "gpio", "d0", "d8"]),
  e("install", "i-cablage-sd", "Optionnel : câbler le lecteur de carte SD du TFT", "Ajouter une microSD au TFT pour conserver l’image et jouer des animations.", "guide", "pratiquer",
    ["microsd", "carte sd", "lecteur sd", "stockage", "tft"]),
  e("install", "i-gpio", "Détail technique : correspondance D0–D8 et GPIO", "Table de correspondance entre les repères D0 à D8 des cartes et les numéros GPIO.", "reference", "comprendre",
    ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "gpio", "broches", "pinout", "nodemcu", "wemos"]),
  e("install", "i-spi-r4", "Détail technique : SPI matériel de l’UNO R4", "Pourquoi et comment l’UNO R4 utilise le bus SPI matériel pour l’écran.", "reference", "comprendre",
    ["spi", "uno r4", "bus", "mosi", "sck", "d11", "d13", "horloge"]),
  e("install", "install-step-4", "Installer et préparer Arduino IDE", "Installer l’environnement Arduino, la carte ESP8266 ou UNO R4 et le port USB.", "guide", "pratiquer",
    ["arduino ide", "logiciel", "ide", "téléverser", "port", "driver", "pilote", "ch340", "cp2102", "windows", "mac", "linux"]),
  e("install", "esp-boards", "Ajouter la carte ESP8266 dans Arduino", "URL du gestionnaire de cartes et installation du paquet ESP8266.", "guide", "pratiquer",
    ["gestionnaire de cartes", "url", "board manager", "esp8266", "paquet", "package"]),
  e("install", "i-port-usb", "Mon ordinateur ne détecte aucun port USB", "Câble de charge seul, pilote USB-série manquant ou carte non alimentée : comment s’en sortir.", "depannage", "pratiquer",
    ["port usb", "com", "tty", "câble", "pilote", "driver", "carte non détectée", "ne se connecte pas", "introuvable"]),
  e("install", "i-r4-wifi", "La R4 ne se connecte pas au Wi-Fi", "Mise à jour du module Wi-Fi, réseau 2,4 GHz, mot de passe : pistes pour l’UNO R4 WiFi.", "depannage", "pratiquer",
    ["wifi", "wi-fi", "r4", "2,4 ghz", "5 ghz", "mot de passe", "module", "connexion"]),
  e("install", "i-blink", "Optionnel : vérifier Arduino avec l’exemple Blink", "Un test minimal pour s’assurer que la chaîne d’outils fonctionne avant d’aller plus loin.", "guide", "decouvrir",
    ["blink", "test", "vérifier", "led", "exemple", "premier essai"]),
  e("install", "install-step-5", "Bibliothèques et firmware à télécharger", "Les bibliothèques à installer et le bon firmware (ou téléchargement automatique) pour la variante.", "guide", "pratiquer",
    ["bibliothèque", "library", "libraries", "firmware", "télécharger", "zip", "ino", "crypto", "arduinojson", "gxepd2", "adafruit"]),
  e("install", "install-step-6", "Ouvrir le code, régler le Wi-Fi et téléverser", "Renseigner le Wi-Fi (ou utiliser le portail), choisir la carte, téléverser le firmware.", "guide", "pratiquer",
    ["wi-fi", "wifi", "ssid", "mot de passe", "secrets.h", "portail", "téléverser", "flasher", "upload", "flash", "installer le firmware"]),
  e("install", "i-flash-size", "Facultatif : réglage « Flash Size » pour les animations", "Garder l’animation après un redémarrage grâce à l’espace de fichiers de la carte.", "guide", "pratiquer",
    ["flash size", "littlefs", "spiffs", "animation", "redémarrage", "4mb"]),
  e("install", "i-microsd", "Facultatif : ajouter une microSD pour le cartel et les animations", "Utiliser une microSD pour le cartel, la dernière image et les animations du TFT.", "guide", "pratiquer",
    ["sd", "carte sd", "cartel", "animation", "tft", "stockage", "microsd"]),
  e("install", "install-step-7", "Laisser le premier démarrage se terminer", "Le premier affichage peut prendre jusqu’à 15 minutes : ce qui se passe et ce qu’il ne faut pas faire.", "guide", "pratiquer",
    ["premier démarrage", "attendre", "15 minutes", "rien ne s’affiche", "écran blanc", "lent", "patience", "clés", "ed25519"]),
  e("install", "i-moniteur-serie", "Voir ce qui se passe dans le Moniteur série", "Lire les messages de la carte pour comprendre son état et diagnostiquer.", "guide", "pratiquer",
    ["moniteur série", "serial", "115200", "logs", "journal", "debug", "messages"]),
  e("install", "onboard", "Associer l’écran et afficher le premier dessin", "Relier l’écran à son profil avec le code affiché (« Connecter mon écran »), puis dessiner.", "guide", "pratiquer",
    ["connecter mon écran", "onboard", "appairage", "pairing", "code", "qr", "profil", "associer", "jumelage", "premier dessin"]),
  e("install", "i-checklist", "L’écran ne fonctionne pas ? Checklist de dépannage", "Une liste de vérifications dans l’ordre pour retrouver un écran qui ne répond pas.", "depannage", "pratiquer",
    ["panne", "ne marche pas", "écran noir", "écran blanc", "pas d’affichage", "problème", "dépannage", "erreur"]),

  // ── Dépannage (le contenu détaillé vient du document markdown ; voir catalogBuild.ts) ──
  e("help", "depannage", "Dépannage : Wi-Fi, première connexion, mises à jour", "Que faire, et à quel moment, quand la carte ne se connecte pas ou ne se met pas à jour.", "depannage", "pratiquer",
    ["aide", "problème", "panne", "ne se connecte pas", "wifi", "mise à jour", "ota", "portail", "notice", "support"]),

  // ── Consommation ───────────────────────────────────────────────────────────
  e("power", "consommation", "Consommation électrique", "Combien consomme chaque montage, quelle alimentation prévoir, quelle autonomie sur batterie.", "reference", "pratiquer",
    ["énergie", "batterie", "autonomie", "watts", "ampères", "alimentation", "usb", "mah", "électricité", "coût"]),
  e("power", "p-courants", "Courant retenu pour chaque composant", "Les courants (veille, pointe, rafraîchissement) retenus pour calculer la consommation.", "reference", "comprendre",
    ["milliampères", "ma", "courant", "veille", "pointe", "sleep", "mesure"]),
  e("power", "p-reduire", "Comment réduire la consommation", "Gestes concrets pour économiser l’énergie : fréquence de pull, rafraîchissements, alimentation.", "guide", "pratiquer",
    ["économiser", "réduire", "batterie", "autonomie", "fréquence", "deep sleep"]),

  // ── Comprendre le réseau ───────────────────────────────────────────────────
  e("network", "reseau", "Comprendre le réseau", "Architecture pull, rôles, consensus, chaîne de blocs et choix techniques de Proof-of-Draw.", "concept", "decouvrir",
    ["réseau", "architecture", "comment ça marche", "fonctionnement", "principe", "blockchain", "chaîne", "présentation"]),
  e("network", "how", "Vue d’ensemble : comment l’écran reçoit une œuvre", "L’écran interroge le serveur (pull), vérifie, vote, puis télécharge l’image : aucun accès entrant.", "concept", "comprendre",
    ["pull", "serveur", "esp", "pas d’ip", "nat", "ssrf", "requête", "flux"]),
  e("network", "n-pull-leger", "Séparation entre le pull léger et le téléchargement binaire", "Pourquoi les métadonnées (~300 octets) et l’image (octets bruts) passent par deux appels distincts.", "concept", "comprendre",
    ["pull-frame", "binaire", "mémoire", "heap", "octets", "tls", "bearssl", "taille"]),
  e("network", "roles", "Les rôles du réseau", "Artiste, validateur, mineur, serveur : qui fait quoi dans la validation d’une œuvre.", "concept", "decouvrir",
    ["artiste", "validateur", "mineur", "serveur", "nœud", "participant"]),
  e("network", "consensus", "Protocole de consensus", "Candidat, votes signés, quorum, minage : comment un dessin devient un bloc.", "concept", "comprendre",
    ["vote", "quorum", "validation", "bloc", "minage", "candidat", "majorité", "signature", "preuve"]),
  e("network", "why", "Solidité technique", "Ce qui rend le réseau robuste : chaîne vérifiable, anti-automatisme, minage équitable.", "concept", "comprendre",
    ["sécurité", "robustesse", "fiabilité", "hash", "sha-256", "anti-bot", "équitable", "tirage"]),
  e("network", "licence", "Licences et droits", "Droits d’auteur des œuvres, licences du code et du matériel.", "reference", "decouvrir",
    ["licence", "droits", "copyright", "auteur", "propriété", "réutiliser", "open source", "cc"]),

  // ── Synthèse technique ─────────────────────────────────────────────────────
  e("synthesis", "synthese", "Synthèse de la technologie", "Toute la technologie sur une page : ce que les cartes calculent, ce que la chaîne garantit, ce qui reste à faire.", "concept", "comprendre",
    ["résumé", "technique", "tout comprendre", "vue d’ensemble", "audit"]),
  e("synthesis", "synth-resume", "En une page", "Le résumé le plus court de ce qu’est Proof-of-Draw et de ce qu’il prouve aujourd’hui.", "concept", "decouvrir",
    ["résumé", "en bref", "tl;dr", "présentation", "pitch", "explication simple"]),
  e("synthesis", "synth-archi", "Architecture : qui fait quoi", "Navigateur, serveur Next.js, Redis, cartes : les responsabilités de chaque brique.", "concept", "comprendre",
    ["architecture", "composants", "next.js", "redis", "vercel", "upstash", "serverless"]),
  e("synthesis", "synth-pipeline", "Du dessin au bloc, étape par étape", "Le trajet complet d’un dessin : soumission, candidat, votes, bloc miné, affichage.", "concept", "decouvrir",
    ["pipeline", "étapes", "parcours d’un dessin", "flux", "soumettre", "afficher", "du dessin au bloc"]),
  e("synthesis", "synth-calcul", "Ce que les cartes calculent réellement", "Quelles vérifications les cartes font elles-mêmes (hash, métriques entières) et lesquelles restent au serveur.", "concept", "comprendre",
    ["vote v2", "métriques", "hash", "calcul local", "entropie", "esp8266", "r4", "vérification"]),
  e("synthesis", "synth-chaine", "La chaîne de blocs et ses preuves", "Contenu d’un bloc, parentHash, vérification publique et conservation.", "concept", "comprendre",
    ["bloc", "hash", "parenthash", "chaîne", "preuve", "vérifier", "blockhash", "remix", "œuvre dérivée", "filiation"]),
  e("synthesis", "synth-niveaux", "Niveaux d’assurance : où en est-on ?", "Ce qui est prouvé, testé sur carte ou seulement annoncé : un vocabulaire honnête.", "etat", "comprendre",
    ["assurance", "niveau de preuve", "N0", "N1", "N2", "N3", "confiance", "honnêteté", "validé", "testé"]),
  e("synthesis", "synth-secu", "Identité, signatures et sécurité", "Clés Ed25519, signatures de vote, modèle de menace et limites actuelles.", "concept", "comprendre",
    ["ed25519", "clé", "signature", "sécurité", "menace", "identité", "usurpation", "tls"]),
  e("synthesis", "synth-anim", "Animations", "Comment une animation devient un bloc, est validée et jouée sur les écrans compatibles.", "concept", "comprendre",
    ["animation", "clip", "gif", "pbc1", "tft", "oled", "boucle", "image par image"]),
  e("synthesis", "synth-ecrans", "Écrans, formats et contraintes", "Résolutions, formats de tampon, couleurs et contraintes mémoire de chaque écran.", "reference", "comprendre",
    ["résolution", "format", "buffer", "tampon", "couleurs", "rgb565", "1 bit", "taille mémoire", "écrans"]),
  e("synthesis", "synth-couts", "Coûts et garde-fous", "Budget Redis, limites de débit, quotas : ce qui protège le service et son coût.", "concept", "comprendre",
    ["coût", "prix", "quota", "redis", "upstash", "limite", "rate limit", "budget", "gratuit"]),
  e("synthesis", "synth-pas", "Ce que PoD n’est pas (encore)", "Les limites assumées : pas de monnaie, pas de décentralisation complète, pas de garantie absolue.", "etat", "decouvrir",
    ["limites", "pas encore", "blockchain", "crypto", "monnaie", "token", "décentralisé", "honnête"]),
  e("synthesis", "synth-glossaire", "Glossaire", "Définition des mots techniques : pull, quorum, bloc, nœud, firmware, e-ink…", "reference", "decouvrir",
    ["définition", "vocabulaire", "lexique", "mots", "sigle", "jargon", "c’est quoi"]),

  // ── État du projet ─────────────────────────────────────────────────────────
  e("roadmap", "feuille-de-route", "Feuille de route : ce qui est fait, ce qui reste", "Vue d’ensemble du travail accompli et à venir, avec un statut honnête (fait, en cours, à faire).", "etat", "decouvrir",
    ["roadmap", "avancement", "futur", "prochainement", "planning", "à venir", "progression", "état du projet"]),
  e("compat", "compatibilite", "Compatibilité matérielle et niveaux de preuve", "Ce que chaque combinaison carte, écran et capteur a réellement démontré (compilé, essayé sur carte, vote réel, mise à jour à distance).", "reference", "pratiquer",
    ["compatible", "matrice", "matériel", "ota", "mise à jour", "testé", "validé", "quelle carte", "support", "état du projet"]),
];
