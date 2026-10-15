# Chronologie extraite du CSV brut Redis MONITOR — ASSAINIE

> **Nature : extraction partielle et assainie** du CSV brut (voir README). Heures = heure LOCALE du moniteur (UTC+2). Les adresses IP, MAC et codes d'appairage du CSV brut sont **omis**. Le CSV n'est **pas un échantillon complet** : il contient des fenêtres (08:48–08:59, 09:12–09:24 locales ; rien entre 08:59:25 et 09:12:16), si bien que les commandes de l'intervalle — dont le minage lui-même et les votes — **n'y figurent pas** ; ils sont établis par le bloc (`bloc_104.json`).

| Heure locale | Événement (commande observée) |
|---|---|
| 08:59:23.459 | `SET candidate:current` — candidat `f31bf066-2d62-4b6d-8835-e6a2b0a331c1`, déposé par le TFT `dev_7B4L17N3` (écran `tft28`) |
| 08:59:23.497 | `SET candidate:votes` `{votes:{}}` (TTL 1800 s) |
| 08:59:23.603 | `SET net:hot` (TTL 1800 s) |
| 08:59:25 → 09:12:16 | **aucune commande dans le fichier** (trou de capture) |
| 09:13:00.022 / .185 | `DEL frame:dev_KAD6PKC4:eink27bw` puis `SET shown:dev_KAD6PKC4:eink27bw` (frameId `5cff3d84-…`) : le multiscreen ACQUITTE la frame |
| 09:13:18.430 / .547 | idem pour `dev_MN67OG7R` (e-ink 2,9″) |
| 09:14:03.210 | `SET chain:block:ae6f263b…` (bloc #104) puis `SET chain:head` à 09:14:03.396 — **ce n'est PAS le minage** : `minedAt` du bloc = 07:11:28 UTC = **09:11:28 locale** ; ces `SET` sont la mise à jour par `obs-confirm` (`revalidated[*].confirmedAt` = 07:14:03 UTC) |
| 09:15:06.481 | `DEL chain:notify:dev_7B4L17N3` |
| 09:15:34.792 | `DEL frame:dev_7B4L17N3:tft28` (la frame est livrée au TFT) |
| 09:15:35.151 / .164 | `SET shown:dev_7B4L17N3:tft28` puis `SET shown:img:5cff3d84-…:tft28` — l'ACK du TFT est enregistré |

Durées déduites (arithmétique des horodatages ci-dessus) : dépôt → minage ≈ **12 min 05 s** (08:59:23 → 09:11:28) ; minage → ACK du TFT ≈ **4 min 07 s** (cadence de pull du TFT, 5 min) ; à noter : dans la première version de cette analyse (conversation), le minage avait été daté 09:14:03, soit ≈ 15 min : **corrigé ici** (c'était la mise à jour d'observation).
