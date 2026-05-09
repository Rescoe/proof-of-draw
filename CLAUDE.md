# CLAUDE.md

## Role

Tu travailles sur le repo existant `proof-of-draw`.

Ta mission n'est PAS de refaire l'application.  
Ta mission est de faire une migration réseau ciblée pour passer d'une architecture à IP locale vers une architecture à devices pull-based.

---

## Read this first

Le repo actuel est déjà fonctionnel en MVP, avec ces points importants :

- `app/onboard/page.tsx` demande encore `name`, `ip`, `port`, `screens`
- `app/api/onboard/route.ts` crée encore des devices à partir de `name + ip`
- `app/api/draw/route.ts` fait encore `sendFrameNow(device.ip, device.port, payload)`
- `app/api/ping/route.ts` fait encore un fetch vers `http://${device.ip}:${device.port}/ping`
- `lib/deviceStore.ts` persiste encore `ip`, `port`
- `lib/queue.ts` fait encore le push HTTP direct
- `lib/canvasToScreen.ts` fonctionne déjà et doit être conservé
- le repo possède déjà les firmwares ESP et les profils d'écrans

Conclusion :
le projet n'a PAS besoin d'une nouvelle app, mais d'une migration d'architecture réseau.

---

## Non-goals

Ne fais PAS :
- refonte UI
- nouveau design
- changement de framework
- base de données
- websocket
- auth blockchain
- wallet
- seed phrase
- logique proof-of-draw complète
- fork duino-coin
- refactor global du repo
- renommage massif des fichiers

---

## Required changes

### A. Replace IP onboarding with pair-code onboarding

Modifier `app/onboard/page.tsx` :
- supprimer les champs `ip` et `port`
- garder le sélecteur d'écrans
- remplacer `name` par `artistName`
- ajouter `pairCode`
- POST vers `/api/onboard` avec :
  ```json
  {
    "pairCode": "...",
    "artistName": "...",
    "screens": [...]
  }
  ```

### B. Add device registration route

Créer `app/api/register/route.ts`.

L'ESP appelle cette route au boot avec :
```json
{
  "mac": "aa:bb:cc:dd:ee:ff",
  "firmware": "1.0",
  "screens": ["eink29bwr"]
}
```

Le serveur répond :
```json
{
  "deviceId": "dev_xxx",
  "pairCode": "AB12-CD34"
}
```

Comportement :
- idempotent sur la MAC
- nouveau device si MAC inconnue
- pairCode généré si nécessaire

### C. Replace ping route behavior

Modifier `app/api/ping/route.ts` :
- entrée : `{ deviceId }`
- action : mettre à jour `lastPing` + `lastSeen`
- sortie : `{ ok: true }`
- aucun fetch vers IP locale

### D. Add pull route

Créer `app/api/pull/route.ts` :
- input : `deviceId`
- output :
  - `{ frame: null }`
  - ou `{ frame: payload }`

Le payload doit être compatible avec `canvasToScreen.ts`.

### E. Change draw route to server-side store

Modifier `app/api/draw/route.ts` :
- garder auth / rate limit / quota si déjà présents
- ne plus contacter les ESP par IP
- utiliser `payload.screen`
- publier/stocker le frame côté serveur
- permettre à tous les devices ayant ce `screen` de récupérer le dernier frame

### F. Replace device model

Modifier `lib/deviceStore.ts`.

Retirer :
- `ip`
- `port`

Ajouter / garder :
- `deviceId`
- `mac`
- `pairCode`
- `artistName`
- `screens`
- `firmware`
- `lastPing`
- `lastSeen`
- `framesSent`

Ajouter helpers nécessaires pour :
- register via MAC
- onboard via pairCode
- ping
- liste devices
- cleanup

### G. Add cleanup

Supprimer les devices inactifs depuis plus de 48h.

Implémentation acceptable :
- helper appelé dans les routes
- ou boucle simple en mémoire
- ou nettoyage opportuniste à chaque lecture/écriture

Pas de DB. Pas de cron externe obligatoire.

### H. Replace queue transport

Modifier `lib/queue.ts` :
- plus aucun fetch vers IP locale
- la queue peut devenir un simple store mémoire ou helper de publication
- elle ne doit plus être un transport réseau sortant

### I. ESP firmware migration

Modifier le firmware ESP pour ce flow :

1. boot
2. connect WiFi
3. POST `/api/register`
4. reçoit `deviceId` + `pairCode`
5. boucle :
   - POST `/api/ping`
   - GET `/api/pull?deviceId=...`
   - render local

Le firmware devient client.
Le serveur ne pousse plus directement sur le LAN utilisateur.

---

## Implementation rules

- faire des changements minimaux
- ne pas casser le build
- respecter les types existants
- réutiliser `canvasToScreen.ts`
- conserver les pages `/draw` existantes autant que possible
- si un fichier doit être créé, utiliser le chemin le plus naturel dans l'arborescence existante
- si une API existante doit changer, le faire avec le moins de surface possible

---

## Delivery format

Quand tu rends le travail :
1. liste les fichiers modifiés
2. liste les fichiers créés
3. donne le contenu complet de chaque fichier modifié/créé
4. explique brièvement les endroits où il faudra ajuster les firmwares selon le modèle d'écran
5. ne donne pas des pseudo-diffs incomplets
6. ne propose pas une réarchitecture totale

---

## Product intent

Le dessin reste centralisé dans l'app web.  
Les ESP sont des display nodes passifs connectés au serveur.  
Le but immédiat est la diffusion synchronisée d'un dessin vers tous les devices compatibles avec un type d'écran.

Exemple :
- un utilisateur dessine pour `eink29bwr`
- le serveur stocke ce frame
- tous les ESP enregistrés avec `eink29bwr` peuvent pull ce frame
- affichage synchronisé sans IP locale

C'est la base technique du futur projet `Proof of Draw`, mais cette phase ne doit implémenter que l'infrastructure réseau de distribution.