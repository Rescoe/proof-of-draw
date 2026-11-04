# Chantier à faire plus tard : témoin de vie sur TOUS les ESP / R4 (décidé le 04/11/2026)

**Importance : haute dès qu'il y aura des clients.** Aucun client ne branchera un câble série. Une carte qui se fige doit se redémarrer seule et dire à distance OÙ elle s'est arrêtée. Prototype : `POD_LIVENESS` sur le BWR + OLED (`multibwr-2.4`, séquence 22, publiée en canari pour `dev_T46HBXG1` le 04/11/2026) — `docs/RELEASE_MULTIBWR_2_4_PREPAREE_2026_11_04.md`, côté serveur `lib/bootReport.ts` + `lib/deviceLog.ts`.

## Condition de départ
**Ne généraliser qu'après le verdict de la `multibwr-2.4`** : si le témoin localise bien la panne du cousin (ou si elle ne se reproduit plus), on saura quelles étapes valent d'être instrumentées partout et si le redémarrage automatique est sûr. Si le témoin lui-même pose problème (faux positifs, boucle), on corrige avant d'étendre.

## À faire, dans l'ordre
1. **Module ESP8266 commun** (`esp8266/_shared/pod_liveness.h`, copie identique par dossier de firmware comme les autres en-têtes partagés, test de copie) : mémoire RTC, minuteur, `LiveGuard`, rapport `rr/rp/rh`. Chaque firmware déclare SES étapes ; la mécanique n'est écrite qu'une fois.
2. **Vocabulaire d'étapes unique** côté serveur (aujourd'hui `BOOT_PHASE_NAMES` pour le BWR) : une table par famille, test d'alignement firmware ↔ serveur pour chacune.
3. **Plafond de redémarrages du témoin** (obligatoire avant tout déploiement large) : au plus N par heure, puis mode dégradé (pas de boucle de redémarrage chez un client).
4. **Variante UNO R4 WiFi** : chien de garde matériel du processeur + une mémoire qui survit au redémarrage (à choisir et à valider sur carte) ; la pile principale de 1 024 o impose les mêmes précautions que pour `PodEd` / `podNetRun` (aucune E/S longue, aucun appel Ed25519 direct, journal sur pile dédiée).
5. **Bloc « Santé de l'appareil » dans Mon profil** : derniers redémarrages et leur cause, lisible par le propriétaire, sans nouvelle donnée stockée (lecture du journal d'appareil existant).
6. **Vue d'ensemble pour l'exploitant** : cartes à redémarrage anormal, par firmware et par étape, à partir des journaux d'appareil (coût Redis à chiffrer AVANT le code).
7. **Propagation firmware par firmware**, un profil à la fois, avec sa ligne de la matrice (`docs/MATRICE_COMPATIBILITE_MATERIELLE.md`) : multiscreen e-ink 2,7″ + OLED (qui a déjà montré un Soft WDT après vote), e-ink 2,9″ BWR, TFT 1,8″, R4 e-ink 2,9″, R4 TFT 1,8″, R4 TFT 2,8″. Niveau de preuve `C` jusqu'à un essai sur carte ; publication OTA = GO distinct.

## Garde-fous (non négociables)
- Ne rapporter que des **numéros d'étape et des causes de reset**, jamais de contenu ni d'identifiant.
- **Coût Redis nul** en usage normal : le rapport voyage dans le `register` existant, déjà journalisé.
- Mesurer la RAM statique de chaque profil (ESP8266 : ≈ 180 o pour le BWR ; règle ≤ 40 000 o) ; sur les profils les plus serrés (BWR + OLED + DHT22), vérifier la marge de tas après chaque ajout.
- Le témoin **ne répare pas la cause** : il redémarre et localise. Chaque blocage localisé devient un correctif à part.
