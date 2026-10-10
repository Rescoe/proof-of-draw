# LOT 8B-2B-2 — PULLFRAME-PHASE-AUDIT2 (10/10/2026)

**Instrumentation SEULE du canari. Aucune correction. Compilé (cœurs 1.5.3 ET 1.6.0) et testé sur l'hôte : jamais flashé.** Base : `3628b3d`. Drapeaux committés : `POD_RENDER_V1 = 0`, `POD_CANARY = 0`. Serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, tailles de pile : inchangés.

## 1. Ce que le matériel a dit

Canari `3628b3d` (AUDIT1), après UN Reset, sans renvoyer d'image (`docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT2_2026_10_10/journal-3628b3d-reset-materiel.txt`) : register 200, register JSON sain (496 o / marge 1488), pull 200, pull JSON sain (708 o / marge 1276), puis

```
[PULL] cartel: La chute de WallStreet / Neo (bloc 87)
[PULL] nouveau bloc #95
[PULL] nouvelle frame 6429e8f5-9ed8-427c-9c3e-018b4e820c05 (personal)
```

et PLUS RIEN. **Aucune ligne `[CANARY] FF n`, pas même FF 1**, qui suit immédiatement ce `logf`. AUDIT1 n'a donc rien localisé. GPT : ne pas conclure « ancien binaire » (le flash n'est pas remis en cause). Le journal ne contient toutefois aucune empreinte de build qui le prouverait : AUDIT2 en ajoute une.

Hypothèses compatibles avec « pas de FF 1 » (aucune n'est tranchée) :
1. blocage dans l'épilogue du `logf` de « nouvelle frame » (restauration de `SP`, effacement + `free` de la pile de journal de 1 536 o) ou juste après ;
2. `podFfSay` a abandonné la ligne : moins de 120 o libres dans le tampon USB pendant 200 ms (le tampon de TX du cœur est de 256 o : `CFG_TUD_CDC_TX_BUFSIZE = 64 × 4`) ;
3. le `logf` de FF 1 lui-même bloque (allocation de 1 536 o sur un tas abîmé, ou écriture USB bornée seulement par le test préalable).

Dans les trois cas, un traçage qui passe par `logf` est le mauvais instrument : il dépend du tas et du port USB qu'on soupçonne.

## 2. Découvertes dans le cœur (1.6.0)

- **USB TX FIFO : 256 o** (`variants/UNOWIFIR4/tusb_config.h`). `_SerialUSB::write` **boucle sans limite** quand il n'y a plus de place et que l'hôte ne vide pas (déjà noté en AUDIT1) ; il ne boucle PAS si la place disponible couvre déjà tout le message (`space >= to_send` ⇒ un seul passage).
- **L'USB est géré par interruption** (`_usbfs_interrupt_handler` appelle `tud_int_handler` + `tud_task`) : le tampon se vide même si le firmware tourne en boucle, sauf interruptions masquées ou processeur en faute.
- **`.noinit` existe** dans `variants/UNOWIFIR4/fsp.ld` (lignes 223-231, `NOLOAD`, `KEEP(*(.noinit*))`, entre `.data` et `.bss`) : une variable placée dans `.noinit` n'est ni copiée ni mise à zéro au démarrage.
- **Écrire sur la pile principale est interdit pour une marque** : `_SerialUSB::write` coûte 270 à 430 o de pile (mesure des lots précédents) ; au retour de `doPull` la marge principale est de 132 à 224 o. Un `Serial.write` direct depuis `doPull` (phases 1, 2, 3, 15) pourrait écrire SOUS `__StackLimit`.

## 3. Conception

Chaque marque fait **deux choses séparées**, par la fonction `podFfNote(n)` (canari seulement) :

1. **Inscription en RAM** dans `g_podFfRec`, 20 o placés en section `.noinit` : `magic`, n° de démarrage, `millis()`, dernière phase, jetons perdus, première phase où le marqueur de pile est détruit (`badAt`), état du jeton de contrôle, somme de contrôle. Scellé **avant** toute sortie série, puis de nouveau après un jeton perdu. Pas d'EEPROM, pas de flash : un reset ne l'efface pas.
2. **Jeton série** — seulement pour les phases **4 à 14** (exécutées sur la pile réseau dédiée de 2 048 o) : `Serial.write` d'**un jeton fixe de 7 o** (`[FF04]\n` … `[FF14]\n`, lu dans une table en flash), uniquement si `Serial.availableForWrite() >= 7`. Sinon : jeton **perdu et compté**. Ni `logf`, ni formatage, ni `String`, ni allocation, ni attente, ni boucle. Les phases **1, 2, 3 et 15** (pile principale) : **inscription seule**, aucune E/S.

Au démarrage (`podFfBoot()`, après la ligne `1b`, suivie d'un contrôle de pile `1c`) :

```
[CANARY] BUILD PULLFRAME-PHASE-AUDIT2 | base 3628b3d | 15 phases + controle | enregistrement RAM .noinit 20 o | compile <date> <heure>
[CANARY] FFREC demarrage precedent n=N : derniere phase P (<nom>) a t=… ms ; jetons perdus=k ; marqueur de pile detruit des la phase X (0 = jamais) ; jeton de controle 1|2
   (ou : FFREC demarrage precedent : AUCUN enregistrement valide …)
[FF00]
[CANARY] FF controle : jeton [FF00] ECRIT|PERDU … ; demarrage n=N+1 ; l'enregistrement est arme
```

L'empreinte du **commit d'instrumentation** ne peut pas être gravée dans le firmware (le hash n'existe qu'après le commit) : elle est remplacée par le nom du lot, le commit de base `3628b3d` et la date et l'heure de compilation (à comparer à l'heure de téléversement de l'IDE).

Le découpage des **15 phases d'AUDIT1 est conservé** (mêmes positions, mêmes blocs gardés, mêmes textes d'appel `POD_FF_MARK(n, "…")` ; le texte n'est plus qu'une documentation). Le statique `g_podFfDrop` disparaît (le compteur vit dans l'enregistrement).

## 4. Coûts mesurés (ELF, cœurs 1.5.3 = 1.6.0)

| | AUDIT1 (`3628b3d`) | AUDIT2 |
|---|---|---|
| Production OFF, flash | 124 580 o | 124 596 o (+16 : longueur du chemin de build) |
| Production, RAM statique | 22 768 o | 22 768 o |
| Canari, flash | 136 428 o | 137 836 o (+1 408) |
| Canari, RAM statique | 22 784 o | 22 784 o (l'enregistrement est en `.noinit`, hors « variables globales » ; `.noinit` = 0x30 o dont les 20 o du lot, en `0x20000398`) |
| Forme IDE 1/1 | — | 137 836 o / 22 784 o, 0 avertissement du sketch |
| Chaînes statiques `setup`/`loop → doPull` (canari) | 800 / 632 o | **800 / 632 o (identiques)** |
| Pile réseau, lambda de `doFetchFrame` | 248 o, reste 880 o | **248 o, reste 880 o (identiques)** |

Production : **texte du sketch identique** à `3628b3d` une fois les blocs de canari retirés (76 372 caractères, vérifié) ; désassemblage normalisé OFF : 1 028 / 1 036 fonctions identiques, les 8 autres sont des données et de la disposition (chemin de build ; `SHA512::processChunk` et sa vtable : deux mots d'une table de constantes décalés de 0x10 par les 16 o de flash). Cœurs 1.5.3 = 1.6.0.

Limite de l'analyse statique : elle ne suit pas les appels virtuels de la pile USB. Le coût réel du `Serial.write` des phases 4 à 14 sur la pile réseau sera lu par la ligne `net http` du canari (marge attendue ≥ 256 o ; ≈ 800 o avant). À la phase 4 la pile réseau n'a utilisé que le cadre de la lambda (≈ 250 o) : l'écriture USB (≤ 430 o) y a largement de la place.

## 5. Tests

`tests/pullFramePhases.test.ts` (réécrit) : 15 marques seules dans leur bloc gardé, dans l'ordre de `Conn::request` / `doFetchFrame` / `doPull` ; `podFfNote` ne contient ni `logf`, ni `String`, ni allocation, ni boucle, ni E/S directe, scelle l'enregistrement AVANT le jeton, n'émet de jeton que pour 4 à 14 ; `podFfToken` : UN `Serial.write` de 7 o, après `availableForWrite() < 7` ; table de 16 jetons dans l'ordre ; enregistrement unique en `.noinit` ; `podFfBoot` (empreinte, validation par la somme, jeton de contrôle, ré-armement) appelé une fois ; rien hors canari ; autres firmwares sans marque. **15 suppressions + 19 mutants refusés.** `canaryPrep` (trois statiques initialisés + un enregistrement `.noinit`), `canaryBootFix2` (point `1c`). Suite : 726 / 728 dans l'arbre du porteur à 0/0 (les 2 échecs habituels viennent de ses copies locales), à confirmer 728 / 728 en clone propre.

## 6. Protocole du prochain canari (après audit GPT et décision du porteur)

Même fichier local `1`/`1`, **sans renvoyer d'image ni de dessin** (la frame personnelle en attente est le bon test : elle ne crée ni candidat ni vote ; un nouvel envoi remplacerait la frame en attente et un dessin soumis au réseau créerait un candidat).

1. Flasher, moniteur série ouvert. Au démarrage, relever : la ligne `BUILD PULLFRAME-PHASE-AUDIT2` (prouve le binaire), `FFREC … AUCUN enregistrement valide` (premier lancement après un flash), le jeton `[FF00]` et `FF controle … ECRIT|PERDU` (prouve que le mécanisme série marche **avant** `doFetchFrame`).
2. Le premier pull (depuis `setup`, le chemin le plus profond) télécharge la frame en attente. Copier TOUT le journal, y compris le silence final ; attendre au moins 2 minutes (un `connect` borné dure ≤ 50 s ; un en-tête ≤ 20 s).
3. Si le firmware se tait : appuyer UNE fois sur Reset. Les premières lignes du démarrage suivant donnent `FFREC demarrage precedent n=1 : derniere phase P …` : c'est la dernière marque atteinte **même si son jeton série a été perdu**.
4. Si `FFREC` annonce « AUCUN enregistrement valide » après un reset : la RAM a été effacée (chargeur d'amorçage ou reset matériel) — l'enregistrement ne vaut alors rien et seuls les jetons série comptent.

## 7. Table de lecture (dernière phase atteinte → zone suspecte)

| Dernière phase (FFREC, ou dernier `[FFnn]`) | Le blocage est entre … et … |
|---|---|
| 0 (aucune) | le `logf` « nouvelle frame » (épilogue : `SP`, effacement, `free`) et la marque 1 |
| 1 | l'appel de `doFetchFrame` et sa marque 2 (prologue, `PodNetInfo`) |
| 2 | marque 2 → marque 3 (construction de la lambda) |
| 3 | `podNetRun` : allocation de 2 048 o, peinture, trampoline, avant la transaction |
| 4 | construction de `Conn` / `WiFiSSLClient` (marque 5), tas |
| 5 | construction de l'URL (`String`) et début de `request` (marque 6) |
| 6 | `client.connect` (borné ≈ 50 s par les commandes AT ; au-delà, anormal) |
| 7 | construction de la requête (`String`) avant `client.print` (marque 8) |
| 8 | `client.print` (écriture TLS) |
| 9 | `readHeaders` (borné 20 s par ligne) |
| 10 | le `logf` `[HTTP GET] … pull-frame` ou le début de la lecture du plan noir |
| 11 | lecture du plan rouge |
| 12 | le `logf` `[FRAME] lu …` ou `readBody` suivant |
| 13 | `client.stop()` |
| 14 | retour de la lambda, épilogue de `podNetRun` |
| 15 | après `podNetRun` : journal `net`, ACK/rendu (déjà couverts par les compteurs habituels) |

`badAt ≠ 0` = le marqueur de la pile principale a été détruit dès cette phase (débordement) ; `jetons perdus > 0` = tampon USB trop plein à cet instant (information, pas un défaut).

## 8. Réserves

- Rien n'est flashé : le mécanisme `.noinit` n'a **jamais tourné sur la carte**. Il peut ne pas survivre au reset si le chargeur d'amorçage de la UNO R4 réécrit cette zone de la RAM (le contrôle par la somme évite alors toute fausse lecture).
- Le cœur effectivement flashé (1.5.3 ou 1.6.0) n'est pas connu ; seul 1.6.0 imprime un rapport de HardFault.
- Observation serveur non expliquée : voir `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT2_2026_10_10/vercel-et-reseau-3628b3d.md` (le pull annonce de nouveau l'identifiant `6429e8f5…` malgré un `send-to-screen` à 18:04:40 qui en fabrique un neuf).
- Aucune récupération n'est implémentée (surveillance par chien de garde, abandon de la frame, redémarrage). À décider seulement après la localisation matérielle.

## 9. Archives

`docs/AUDIT_GPT_3628B3D_PULLFRAME_2026_10_10.md`, `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT2_2026_10_10/` (journal série du Reset, note Vercel, chaînes statiques avant/après, pile réseau, comparaison de production, tailles), sauvegarde `firmware-backups/2026-10-10_avant-pullframe-phase-audit2/`.
