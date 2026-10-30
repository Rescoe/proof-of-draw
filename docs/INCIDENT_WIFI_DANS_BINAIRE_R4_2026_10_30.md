# Incident — identifiants Wi-Fi dans un binaire R4 publié (30/10/2026)

**Aucune valeur secrète n'est reproduite dans ce document ni dans le dépôt.**

## Faits
- Le 30/10/2026, la release R4 `r4tft18-2.7` (séquence 2) a été publiée en fichiers statiques (commit `0ae60a9`, retirée par `d76e3f0`). Le binaire avait été compilé avec le `secrets.h` du banc : **le SSID et le mot de passe y figuraient en clair** (vérifié par recherche d'octets sur le fichier, SHA-256 `aa809140a0e40da75e012c423cf26b0743036d43be4abce73aeceae14f522755`).
- Exposition : servi par le CDN du site pendant ≈ 25 minutes, puis 404 prouvé sur tous les chemins `/firmware-r4/…` ; **présent dans l'historique du dépôt PUBLIC** (le blob de `0ae60a9`). L'historique n'a pas été réécrit.
- Le mot de passe courant figurait déjà dans **8 anciens commits publics** : `35b7b96`, `8e0d6c4`, `7259d92`, `467df91`, `24d066d`, `c09aa46`, `fe977d9`, `8472c33` (codés en dur dans d'anciens sketches ; retirés de l'arbre depuis, jamais de l'historique). Le réseau et son mot de passe sont donc à considérer comme **compromis depuis longtemps**.
- Aucune trace dans l'arbre actuel (1 568 fichiers examinés ; `docs`, `lib`, `app`, `esp8266`, `arduino_uno_r4`, `tests`, `scripts`, `public`, `ota-releases`).

## Autres secrets : vérification
- **Graines privées des clés OTA R4 (`r4-a`, `r4-b`)** : générées le 30/10/2026 hors dépôt ; recherche dans tout l'historique : **aucun commit**.
- **Clés privées de publication OTA des ESP (`release-a/b.private.pem`)** : recherche d'une ligne distinctive du corps PEM dans tout l'historique : **aucun commit** ; motifs `BEGIN … PRIVATE KEY` hors code/doc : **aucun** ; aucun `.seed`, `.private.pem`, `.env`, `secrets.h` réel suivi.
- **Clé privée d'appareil Ed25519** : jamais écrite dans un fichier par le firmware ; elle n'est affichée qu'une fois sur l'écran à la génération. Non vérifiable par motif ; aucune trace trouvée dans `docs/mesures`.
- Les clés publiques ne sont pas secrètes.

## Corrections déjà faites
- Release retirée, 404 prouvé (`d76e3f0`).
- **Contrôle bloquant** `ota-lab/r4-ota5/tools/wifi-guard.mjs` : refuse une image qui contient une valeur Wi-Fi interdite (recherche d'octets), le marqueur de Wi-Fi compilé (`PODWIFI:compiled-v1`), ou qui n'a pas le marqueur de Wi-Fi hors binaire (`PODWIFI:record-v1`), ou un `secrets.h` réel dans le dossier de build ; branché sur `publish-r4-release.mjs` (avant toute copie dans `public/`) et sur le build de la station ; valeurs interdites lues dans des fichiers locaux (`secrets.h`, `~/.pod-wifi-forbidden.txt`), jamais affichées ; échec fermé si aucune valeur n'est fournie ; mutants testés (`tests/r4StationPortal.test.ts`).
- Station : mode portail (Wi-Fi hors binaire) pour toute image publiable.

## Décision du porteur (30/10/2026) et action de clôture
Le porteur **ne change pas les identifiants maintenant** : l'exposition publique est connue et acceptée **temporairement** ; la rotation est une **action de clôture du chantier, encore nécessaire, non bloquante pour le canari**. Les valeurs actuelles sont dans `~/.pod-wifi-forbidden.txt` (hors dépôt, jamais affichées) et servent de référence interdite : `wifi-guard` refuse tout binaire qui les contient. À la clôture : changer le mot de passe (et le SSID si possible), ajouter les nouvelles valeurs au fichier, puis exécuter le plan de purge ci-dessous si le porteur le décide.

## Plan de purge de l'historique (SÉPARÉ, NON EXÉCUTÉ — décision du porteur après rotation du Wi-Fi)
Pré-conditions : Wi-Fi changé ; accord explicite ; fenêtre de coordination (tous les clones et worktrees à jeter ou rebaser ensuite) ; aucune PR ouverte.
1. Lister les blobs concernés (`git log --all -S<valeur>` avec la valeur lue depuis un fichier local, jamais collée) : les 9 commits ci-dessus et leurs fichiers.
2. Sur un clone miroir neuf : `git filter-repo --replace-text <fichier local des valeurs>` (ou `--path` pour retirer `public/firmware-r4/` de `0ae60a9`), vérifier par recherche d'octets sur tout l'historique réécrit.
3. Sauvegarder l'ancien dépôt (miroir) hors ligne ; force-push coordonné des branches et tags ; demander à GitHub la purge des vues en cache et des PR ; invalider les anciens clones (nouveau clone obligatoire).
4. Refaire pointer les worktrees ; relancer `npm ci` et les tests ; consigner l'opération.
Tant que ce plan n'est pas exécuté, la seule protection est la rotation du Wi-Fi : un secret publié dans un dépôt public doit être traité comme définitivement divulgué.
