# Procédure — reprendre le projet sur le nouveau PC (29/10/2026)

Complète `docs/ETAT_GIT_ET_REPRISE_MULTI_PC.md` (PR #23). **Rien ne se supprime sur l'ancien PC avant que le clone du nouveau PC ait été comparé et validé.**

## 1. Cloner et vérifier (nouveau PC, aucun secret nécessaire)
```bash
git clone https://github.com/Rescoe/proof-of-draw.git
cd proof-of-draw
git checkout main && git log --oneline -3        # doit contenir « Merge pull request #23 »
```
Node : la version est dans `.nvmrc` (**22.13.0**). Le PC actuel a `22.12.0` par défaut (nvm : 22.19.0 et 22.12.0 installés) : sur le nouveau PC, `nvm install 22.13.0 && nvm use` (ou une 22.x ≥ 22.13).
```bash
npm ci                    # le fichier package-lock.json fait foi ; ne jamais « npm install » pour reprendre
npx tsc --noEmit          # doit être propre
npm test                  # attendu : mêmes échecs préexistants qu'avant (harnais C++ du rendu, vérifications de texte de firmware) — voir docs/ETAT_ACTUEL_CANONIQUE.md ; AUCUN nouvel échec
```
Au 29/10/2026 : 1 429 tests, 73 échecs préexistants (harnais C++ du rendu et vérifications de texte de firmware). Comparer la liste, pas seulement le nombre.

## 2. Secrets : recréés localement, jamais copiés dans Git
Fichiers à recréer à la main (les valeurs viennent du coffre / des consoles, pas du dépôt) :
- `.env.local` (Redis/Upstash : jeton **lecture seule** pour l'exploration, jeton d'écriture seulement si nécessaire ; variables Vercel : `OTA_*`, `CLIP_TICKET_SECRET`, …) ;
- `esp8266/*/secrets.h` et `arduino_uno_r4/*/secrets.h` (Wi-Fi) à partir des `secrets.h.example` — **les firmwares distribués n'en ont pas besoin** (portail Wi-Fi) ; un build local « migration » en contient et ne doit jamais être partagé ;
- clés de publication OTA **privées** `~/.pod-ota-release/release-a.private.pem` et `release-b.private.pem` : à transférer par un canal chiffré (jamais Git, jamais mail en clair) ; sans elles aucune release ne peut être signée ; les clés publiques sont dans le dépôt.

## 3. Artefacts privés de l'ancien PC à NE PAS perdre (non versionnés)
- `canary-builds/` (binaires locaux, sauvegardes de flash **qui contiennent le Wi-Fi** : restauration par câble en cas de carte défaillante) ;
- `ota-lab/esp8266-canary/tools/` (`build-bwr.mjs`, `run-bwr-test.mjs`, …) et les `*-BUILD-PIN.json` locaux : **présents seulement sur l'ancien PC**, absents de `main` ; ils sont nécessaires pour reconstruire les binaires. À copier ou à faire intégrer à Git (décision à prendre) ;
- `docs/captures/`, `docs/mesures/REPRISE_WIFI_2026_10_18/`, `firmware-backups/2026-10-24_avant-chaines-en-flash/` (inventaire détaillé : `docs/INVENTAIRE_LOCAL_A_PRESERVER_2026_10_29.md`) ;
- l'arbre de travail principal de l'ancien PC (branche `claude/ota-1-manifest-contract`, fichiers modifiés non commités : `CLAUDE.md`, `esp_eink_2.9BWR.ino`, `build-bwr.mjs`…).

## 4. Comparaison avant tout nettoyage
Sur chaque PC : `git status --short`, `git stash list`, `git worktree list`, `git branch -vv`. Comparer les deux sorties et les arbres `ls ota-releases docs/mesures`. Le clone est validé quand : `main` identique, `npm ci` + `tsc` + `npm test` donnent les mêmes résultats, les secrets recréés permettent `npm run dev` en lecture seule.

## 5. Worktrees de l'ancien PC (inventaire, AUCUN retrait avant validation du clone)
`git worktree list` montre ≈ 12 arbres : le principal, trois sous `~/.codex/worktrees/` et sept sous `AppData/Local/Temp/claude/…/scratchpad/` (`wt-v3` = branche `claude/multibwr-migration`, `wt-v4`, `wt-bwr`, `wt-dist`, `wt-dms`, `wt-hyb`, `wt-min`, `wt-ms`) plus un sous `Documents/ChatGPT/ANA/worktrees/`. Après validation du clone seulement : pour chacun, (1) `git status` propre ? (2) `git log origin/main..<branche>` : commits uniques ? (3) archiver ces commits (étiquette `archive/<date>/<branche>` poussée), (4) retirer **uniquement** les arbres confirmés propres et sans commit unique (`git worktree remove`, jamais `--force`). Un arbre avec `node_modules` lié ne se supprime pas avec `rm -rf`.
