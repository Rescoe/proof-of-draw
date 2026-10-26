# Lot OTA-5 — R4-B signé : contrat, outils hôte, noyau C++ et prototype de laboratoire (hors matériel)

> 17/10/2026. Branche `claude/ota-1-manifest-contract`. **Aucun port ouvert, aucun téléversement, `ota.update()` jamais appelé, aucun test de coupure, firmware TFT non restauré : la carte est restée en build A du canari.** Décision d'architecture : `docs/ADR_OTA_5_R4B_MANIFESTE_SIGNE_2026_10_17.md`. Prochain essai : `docs/PROTOCOLE_MATERIEL_R4B_2026_10_17.md` (attend un GO matériel).

Formulation : **la mécanique OTA R4 fonctionne sur la carte de test ; la couche de sécurité et l'intégration de production restent à construire.** Le binaire téléchargé est placé dans une zone de staging non approuvée ; il ne devient flashable qu'après validation de la signature du manifeste, du hash complet et de la relecture. Ce lot n'affirme jamais que chaque octet est déjà vérifié au moment où il est écrit.

## Commits

| # | Commit | Contenu |
|---|---|---|
| 1 | `fc216e3` | correction du document OTA-3 (build A, formulation factuelle de la condition « port série fermé ») |
| 2 | `000e256` | ADR OTA-5 : R4-B, contrat cryptographique par famille, inventaire de la data flash, séquence en deux blocs |
| 3 | `0fbd2f5` | manifeste R4 (`lib/otaManifestR4.ts`) et outils hôte (`ota-lab/r4-ota5/tools/`) |
| 4 | `c313592` | noyau C++ `consensus-pod/src/podOtaR4.h`, harnais hôte, vecteurs TS → C++, mutants |
| 4 bis / 5 | ce commit | croquis de laboratoire compilé, synchronisation des en-têtes, mesures statiques, protocole matériel, ce document |

## Fichiers

Créés : `lib/otaManifestR4.ts` · `ota-lab/r4-ota5/tools/{keygen,make-manifest,verify-manifest,compare-staging,negatives,serve}.mjs` · `consensus-pod/src/podOtaR4.h` · `consensus-pod/host/ota_r4_harness.cpp` · `consensus-pod/test-vectors/ota-r4-vectors.txt` · `scripts/gen-ota-r4-vectors.ts` · `tests/helpers/otaR4Vectors.ts` · `tests/otaManifestR4.test.ts` · `tests/otaR4Core.test.ts` · `ota-lab/r4-ota5/sketch/ota5_r4b_probe/{ota5_r4b_probe.ino, secrets.example.h, copies synchronisées des en-têtes}` · `docs/mesures/OTA5_2026_10_17/*` · ce document et le protocole.
Modifiés : `.gitignore` (graines, artefacts, logs, secrets du laboratoire) · `scripts/sync-bench-header.js` (enregistre `podOtaR4.h`, `pod_ssl_bounded.h`, et les copies de `podEdStack.h` / `podNetStack.h` du croquis).
Non touchés : journaux bruts, verdicts archivés (`ota-lab/r4-ota3/runs`, `docs/mesures`), OTA-1 (`lib/otaManifest.ts`), firmwares de production, `consensus-pod/src/podOta.h`.

## Ce que fait le contrat (`[hôte]`)

Manifeste texte ASCII, 10 lignes, ordre fixe, ≤ 512 o : `schema, family, firmware, seq, channel, size, sha256, notbefore, keyid, sig`. Signature Ed25519 de `"POD-OTA-R4-MANIFEST-V1\n" || corps`. Refus fermés (ordre identique en TypeScript et en C++) : analyse (champ inconnu / manquant / dupliqué / en désordre, schéma, famille, forme de la version, entiers canoniques, `seq` hors 1…2³¹−1, taille nulle ou > 0x3C000, canal, hash mal formé ou en majuscules, clé inconnue, signature mal formée) → **signature** (clé absente ou nulle refusée) → famille → canal (`development` jamais éligible) → compatibilité de vote (`VOTE_V2_FIRMWARE`, table recopiée et comparée par test) → séquence (≤ installée refusée : rejeu et downgrade) → activation différée. Puis binaire : Content-Length obligatoire et égal à la taille signée, un octet de plus ou de moins refusé, SHA-256 complet comparé deux fois (réception, puis **relecture** du staging), vecteurs Cortex-M, ticket à usage unique.

## Preuves (`[hôte]` sauf mention)

- `node --import tsx --test tests/otaManifestR4.test.ts tests/otaR4Core.test.ts` : 12/12.
- Vecteurs : **46** manifestes (dont chaque refus) produits par la référence TypeScript ; le noyau C++ rend le **même verdict** que la référence sur chacun, avec la vraie bibliothèque Crypto 0.4.0. Un vérificateur CLI indépendant (`node:crypto` seulement) est d'accord avec la référence.
- Harnais C++ : **204** contrôles — flux (morceaux de 1, 77, 200, 333, 4 096 o ; écritures ≤ 200 o, séquentielles), Content-Length absent / faux, excès, troncature, écriture de staging en échec, relecture différente ou incomplète, vecteurs invalides (5 cas), ticket forgé, réutilisation du ticket, programmation sans ticket, **séquence** (alternance des blocs 2 et 3, rejeu, CRC, magic / version / nature / réservé altérés avec CRC recalculé, deux blocs invalides → refus, écriture qui ment, **coupure à chaque octet d'une écriture de bloc depuis 3 états de départ : la séquence ne baisse jamais, le bloc 0 est intact, une reprise propre est possible**).
- Mutants : **70** entrées C++ (dont une composée) et **19** côté TypeScript ; chacun fait échouer son harnais. **3 gardes sont documentées comme redondantes** (ASCII, fin de ligne finale, taille maximale du manifeste : aucun texte valide champ par champ ne peut les enfreindre) : leur mutant isolé survit, la version composée meurt.
- Discipline `[code]` : le noyau ne contient ni `OTAUpdate`, ni `download(`, ni `Serial`, ni allocation, ni `WiFi` ; un seul appel de programmation, derrière `consume()`.

## Prototype de laboratoire `[code]`

`ota-lab/r4-ota5/sketch/ota5_r4b_probe` : commandes `w s p m d q x`, aucune automatique, **aucune programmation** (pas même `ota.begin`). Compilé avec arduino-cli, FQBN `arduino:renesas_uno:unor4wifi` : cœur 1.6.0 TLS (85 628 o de flash, 11 592 o de RAM statique), cœur 1.6.0 clair (81 996 o), cœur 1.5.3 TLS (85 620 o). Détails : `docs/mesures/OTA5_2026_10_17/compilation.txt`. **Jamais flashé.** Toute opération sur le module est sur une pile dédiée (`podWifiRun`, ou la pile réseau agrandie pour `+FS` pendant la lecture TLS) ; Ed25519 sur `PodEd` ; journal sur la pile de journal ; l'écriture de la séquence n'est volontairement pas câblée.

## Limites et points non démontrés

`[carte]` : rien de nouveau n'a été mesuré dans ce lot. `[hyp]` : le flux TLS + `+FS` sur une même pile réseau ; la capacité de SPIFFS ; la vitesse d'écriture sous TLS ; la compatibilité de l'accès à la data flash avec le module ; le comportement sur coupure d'alimentation ; l'intégration au firmware TFT 2,8″ (RAM statique et marge de pile du vote) ; la distribution et la rotation des clés ; la source de temps pour l'activation différée (`now = 0`, donc refus). Les estimations de pile du protocole sont statiques et majorantes.
