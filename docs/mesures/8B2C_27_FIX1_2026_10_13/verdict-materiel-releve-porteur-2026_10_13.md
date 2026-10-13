# Verdict matériel — canari ESP8266 + e-ink 2,7″ BW + OLED (13/10/2026)

**Relevé transmis par le porteur, transcrit tel quel.** Ce fichier n'est PAS le journal série brut (il n'a pas été fourni à l'archiviste) : aucune ligne de journal n'est reconstruite ici. Le journal brut (`[CANARY]`, `[HEAP]`, `[HTTP …]`) reste à déposer dans ce dossier (`journal-serie-brut-2026_10_13.txt`) par le porteur.
Build testé : `b94bfb9` (branche `claude/esp8266-eink27-oled-canary-8b2c`), canari local `POD_RENDER_V1 = 1`, `POD_CANARY = 1` (drapeaux dans `pod_canary_flags.h` de la copie ignorée `canary-builds/esp27-oled-canary-fix1`). Aucun vote.

## Affichage, rendu, ACK
- orientation et affichage e-ink jugés corrects par le porteur ;
- rendu v1 terminé ; 182 appels du producteur ; appel maximal 747 µs ; intervalle maximal entre appels 3 083 µs ;
- pile contiguë minimale pendant le flux : 752 o ;
- BUSY après Init : 0 ms ; BUSY maximal au rafraîchissement : 2 102 ms ; aucun dépassement du plafond ; aucun BUSY TIMEOUT ;
- renderHash : `b6e2e298bda2aad24ac699a2ae5c60e29829d2f106e0c8aabf33361c3f2f742a` ;
- ACK `/api/ack-frame` : HTTP 200 ; frame acquittée : `d52e9874-7bfe-4b9a-bfcd-0d3d5fc6b51b` ;
- la frame affichée était `source=consensus` (déjà minée), pas `personal` : le canari l'a reçue, affichée et acquittée, sans voter.

## Coexistence e-ink / OLED
- OLED après e-ink : `reinit=OK`, contenu restauré ;
- animation OLED de 9 images toujours active après le rendu et pendant les pulls.

## Mémoire à l'ACK
- pile contiguë minimale globale observée pendant l'ACK : 384 o ; tas après ACK : 39 456 o ; plus grand bloc : 18 408 o ; fragmentation : 41 %.

## Stabilité prolongée : quatre pulls supplémentaires espacés d'environ 300 s, tous réussis
- avant chaque pull : tas 39 952 o, plus grand bloc 21 264 o, fragmentation 36 %, pile 384 o ;
- après chaque pull : tas 39 512 o (identique à chaque fois), plus grand bloc entre 16 720 et 18 432 o, fragmentation entre 41 et 44 % ;
- aucune fuite progressive, aucun reset, aucune exception, aucun REFUS, aucun vote ni `validation-result`.
