# Audit GPT — canari `b03c0b4` : débordement localisé dans `deserializeJson`

| Champ | Valeur |
|---|---|
| Date | 10/10/2026 |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Build | local, `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Verdict sur `DOPULL-PHASE-AUDIT1` | **ACCEPTÉ matériellement** |
| Verdict global | **CORRECTIONS REQUISES avant toute frame** |
| Première phase fautive | **4 : pendant `deserializeJson(doc, resp)`** |
| Redis / Neon | Redis +0, Neon 0 |

## 1. Résultat matériel

Les phases 1, 2 et 3 sont saines. La première différence exacte du marqueur ou de la longueur peinte est observée à la phase 4, immédiatement après `deserializeJson` : la corruption survient donc entre la création de `JSON_DOC(doc, 2048)` et la fin de la désérialisation.

Le chemin réseau est revenu avant cette opération. Dans ce build, les sondes internes de PodNet sont enfin réellement compilées ; aucune phase PodNet n'est signalée. Les mesures restent saines :

- Wi-Fi dédié : 448 à 608 octets utilisés, marges de 864 à 1 024 octets ;
- Ed25519 dédié : marge minimale 708 octets ;
- PodNet register et pull : 1 136 octets utilisés, marge 848 octets ;
- HTTP register et pull : 200 ;
- pile principale avant `doPull` : 880 / 1 024 octets au maximum historique, mais le marqueur est encore intact à la phase 3 ;
- aucune frame, aucun vote ni ACK après l'anomalie.

Le défaut est donc local au traitement ArduinoJson de la réponse `/api/pull`, après fermeture de la transaction TLS. Il ne vient ni du rendu, ni de l'écran, ni de la signature, ni de la pile Wi-Fi ou réseau.

## 2. Lecture de l'analyse statique

Le premier pull est appelé depuis `setup`, qui conserve 168 octets de pile de plus que `loop` :

- `setup -> doPull` : 536 octets sont déjà engagés avant les appelés de `doPull` ;
- `loop -> doPull` : 368 octets ;
- chaîne statique de `deserializeJson` : environ 352 octets sous `doPull`, soit un cumul estimé à 888 octets depuis `setup`.

La mesure réelle est plus défavorable que cette estimation, ce qui est cohérent avec les appels indirects, les interruptions et les cadres variables non intégralement suivis par l'analyse ELF.

La conversion ArduinoJson vers `String` de la branche observation est encore plus profonde : cumul statique de 1 120 octets depuis `setup`, et 952 depuis `loop`. Déplacer seulement le premier pull vers `loop` réduirait le symptôme immédiat mais laisserait cette branche avec seulement 72 octets de marge théorique. Ce n'est pas une correction suffisante.

## 3. Correction de fond recommandée : `DOPULL-JSON-STACK-FIX1`

Créer une pile de travail dédiée au décodage du pull, distincte des piles PodNet, Wi-Fi, Ed25519 et journal. La transaction TLS doit être entièrement terminée avant son activation.

### Contrat

1. `httpCall` remplit `resp`, ferme le client et retourne sur la pile principale.
2. Un helper `noinline`, par exemple `parsePullResponse`, est exécuté par un lanceur de pile de travail dédié.
3. Dans cette pile doivent vivre ensemble :
   - `JsonDocument` ;
   - `deserializeJson` ;
   - toutes les lectures et conversions `JsonVariant -> String` ;
   - la branche `pendingObservation`, y compris sa sérialisation ;
   - l'extraction de `ownedBlock`.
4. Le helper remplit une structure de résultat appartenant à l'appelant. Le document JSON est détruit avant le retour sur la pile principale.
5. Les effets secondaires (EEPROM, changement d'état global, affichage, vote, ACK) ne commencent qu'après un retour valide du parseur.
6. Échec fermé : `NOMEM`, imbrication, garde détruite, marge inférieure à 128 octets, JSON invalide ou sortie dépassant ses bornes => pull rejeté, aucune frame, aucun vote, aucun ACK, aucun redémarrage.

### Dimensionnement et preuves

- point de départ recommandé : 2 048 octets alloués temporairement au tas, garde de 64 octets, minimum 128 et objectif 256 octets ; la taille définitive doit être confirmée par le canari, pas seulement par l'ELF ;
- journaliser au canari l'utilisation, la marge, l'erreur et le tas libre avant/après ;
- refuser toute imbrication avec PodNet, PodEd, PodWifi ou la pile de journal ;
- effacer la pile temporaire avant `free` ;
- tester les réponses : minimale, cartel, frame, candidat, observation maximale autorisée, `ownedBlock`, 429, JSON tronqué et JSON surdimensionné ;
- vérifier que la mémoire de sortie est bornée et que toute chaîne trop longue est refusée ou tronquée selon un contrat écrit, jamais implicitement ;
- compiler les cinq firmwares R4 avec les cœurs 1.5.3 et 1.6.0 ;
- prouver que le chemin désactivé reste inchangé et que Redis, Neon, protocoles et polling restent à +0.

## 4. Ce qu'il ne faut pas faire

- ne pas se contenter de déplacer le premier pull de `setup` vers `loop` ;
- ne pas augmenter la pile principale ou une pile réseau sans mesure ;
- ne pas parser le JSON pendant que TLS est vivant ;
- ne pas répartir partiellement le parseur entre la pile principale et la pile de travail ;
- ne pas envoyer de frame avant un canari sans frame complet ;
- ne pas activer le TFT 2,8 pouces, toujours bloqué par sa marge de vote de 60 octets.

## 5. Prochain protocole matériel

Après audit du correctif hôte :

1. canari e-ink 2,9 pouces sans frame pendant register + trois pulls ;
2. exiger aucune alerte, toutes les piles dédiées avec marge >= 256 octets visée et >= 128 obligatoire, tas libre stable ;
3. seulement ensuite, une frame personnelle unique ;
4. vérifier rendu, `frameHash`, `renderHash`, absence de watchdog, BUSY et ACK ;
5. arrêter immédiatement au premier verrou.

## 6. Réserve d'audit hôte

La suite ciblée n'a pas pu être relancée par GPT sur le poste au moment de cet audit : Node/tsx échoue avant de charger les tests avec `uv_os_get_passwd returned ENOMEM`. C'est une erreur de ressources du poste, sans exécution du code testé, et non un échec des tests du lot. Les résultats de Claude restent 711/711 depuis un clone propre ; ils devront être relancés quand les ressources du poste seront revenues à la normale.
