# AGENTS.md

## Mission

Le projet `proof-of-draw` est une application Next.js + firmware ESP8266 pour dessiner depuis le web et afficher les frames sur des écrans e-ink / OLED connectés à des ESP.

L'application existe déjà et fonctionne en MVP.  
**Ne pas refaire l'application. Ne pas restructurer le projet. Ne pas refactoriser l'UI globalement.**

Le travail attendu consiste uniquement à faire évoluer l'architecture réseau :

- ancien modèle : `Web App -> serveur -> IP ESP locale`
- nouveau modèle : `ESP -> serveur (register + ping + pull)`
- le serveur devient la source unique de vérité
- l'ESP devient un client du serveur
- l'utilisateur continue de dessiner sur l'app web, jamais directement sur l'ESP

---

## Contexte actuel du repo

Le repo contient déjà :

- `app/onboard/page.tsx` : onboarding actuel basé sur `name + ip + port + screens`
- `app/api/onboard/route.ts` : enregistre un device avec `ip` et `port`
- `app/api/draw/route.ts` : envoie encore vers l'ESP par IP
- `app/api/ping/route.ts` : ping encore l'ESP via `http://ip:port/ping`
- `lib/deviceStore.ts` : stocke `id, name, ip, port, screens, lastPing, lastDraw, framesSent`
- `lib/queue.ts` : `sendFrameNow(ip, port, payload)`
- `lib/canvasToScreen.ts` : déjà fonctionnel, à conserver
- firmwares ESP dans `esp8266/esp_eink_2.7BW_OLED` et `esp8266/esp_eink_2.9BWR`

---

## Contraintes absolues

- ne pas ajouter de base de données
- ne pas refaire les pages
- ne pas casser `useCanvasDrawing`
- ne pas remplacer `canvasToScreen.ts`
- ne pas transformer le projet en nouvelle app
- ne pas ajouter blockchain / wallet / seed / token maintenant
- ne pas déployer
- ne pas modifier le design global
- ne pas inventer une nouvelle architecture de fichiers

---

## Objectif fonctionnel

Mettre en place une version fonctionnelle où :

1. l'ESP démarre
2. l'ESP appelle `POST /api/register`
3. le serveur crée ou retrouve le device via son adresse MAC
4. le serveur retourne `deviceId + pairCode`
5. l'utilisateur ouvre `/onboard`
6. l'utilisateur saisit son nom (`artistName`) et un code d'association (`pairCode`)
7. l'utilisateur choisit les écrans connectés
8. le serveur associe ce device au profil utilisateur
9. quand l'utilisateur dessine sur un type d'écran donné, la frame est stockée côté serveur
10. tous les ESP enregistrés ayant ce `screen` récupèrent la frame via `GET /api/pull`
11. les ESP affichent localement la frame
12. chaque ESP fait un `POST /api/ping` régulièrement
13. les devices inactifs depuis plus de 48h sont nettoyés

---

## Architecture cible

### Web app
- garde le canvas centralisé
- continue d'utiliser `canvasToScreenPayload(...)`
- n'envoie plus jamais directement à une IP locale
- envoie les frames au serveur uniquement

### Serveur
- stocke les devices en mémoire / JSON simple
- stocke les frames en mémoire
- associe frames et types d'écrans
- fournit des routes `register`, `ping`, `pull`
- ne fait plus aucun fetch arbitraire vers les IP des utilisateurs

### ESP
- se connecte au WiFi
- contacte le serveur
- s'enregistre avec MAC + firmware
- reçoit `deviceId + pairCode`
- ping régulièrement
- pull les frames
- affiche ce qu'il reçoit
- n'expose plus `/frame` comme point d'entrée principal pour l'architecture cible

---

## Modifications attendues

### 1. `app/onboard/page.tsx`
Modifier la page existante, sans refaire l'UI :
- supprimer les champs IP et port
- garder la logique de sélection des écrans
- renommer le champ `name` côté métier en `artistName`
- ajouter un champ obligatoire `pairCode`
- envoyer à `/api/onboard` :
  ```json
  {
    "pairCode": "...",
    "artistName": "...",
    "screens": [...]
  }
  ```

### 2. `app/api/onboard/route.ts`
Réécrire la logique :
- ne plus accepter `ip`, `port`
- ne plus générer l'identité depuis `name + ip`
- rechercher le device via `pairCode`
- attacher `artistName`
- mettre à jour les `screens` choisisis par l'utilisateur
- retourner le `deviceId` et l'état du device associé

### 3. `app/api/register/route.ts`
Créer cette route.
Body attendu :
```json
{
  "mac": "xx:xx:xx:xx:xx:xx",
  "firmware": "1.0",
  "screens": ["eink29bwr"]
}
```
Réponse :
```json
{
  "deviceId": "dev_xxx",
  "pairCode": "AB12-CD34"
}
```

Règles :
- si MAC déjà connue : réutiliser le même device
- si nouvelle MAC : créer un nouveau device
- générer un `pairCode`
- initialiser `lastSeen` / `lastPing`

### 4. `app/api/ping/route.ts`
Réécrire pour recevoir :
```json
{ "deviceId": "dev_xxx" }
```
et faire uniquement :
- update `lastPing`
- update `lastSeen`
- réponse `{ ok: true }`

Aucun fetch vers IP locale.

### 5. `app/api/pull/route.ts`
Créer cette route.
Entrée :
- `GET /api/pull?deviceId=...`
- optionnellement `screen=...`

Sortie :
```json
{ "frame": null }
```
ou
```json
{
  "frame": {
    "screen": "eink29bwr",
    "black": "...",
    "red": "..."
  }
}
```

### 6. `app/api/draw/route.ts`
Réécrire sans transport IP :
- ne plus utiliser `device.ip`
- ne plus appeler `sendFrameNow(device.ip, device.port, payload)`
- utiliser `payload.screen` issu de `canvasToScreenPayload`
- stocker le frame côté serveur
- diffuser logiquement par type d'écran, pas par IP

Important :
- l'utilisateur dessine sur un écran cible (`screen`)
- tous les devices ayant ce même `screen` doivent pouvoir récupérer la dernière frame publiée

### 7. `lib/deviceStore.ts`
Faire évoluer le modèle de données.

Supprimer :
- `ip`
- `port`

Garder / ajouter :
- `deviceId`
- `mac`
- `pairCode`
- `artistName`
- `screens`
- `firmware`
- `lastPing`
- `lastSeen`
- `framesSent`

Ajouter les helpers nécessaires :
- `registerDevice(...)`
- `getDeviceById(...)`
- `getDeviceByPairCode(...)`
- `getDeviceByMac(...)`
- `updatePing(...)`
- `attachOnboardData(...)`
- `cleanupInactiveDevices()`

Règle de cleanup :
- si `Date.now() - lastSeen > 48h`, supprimer le device

### 8. `lib/queue.ts`
Le fichier ne doit plus envoyer vers une IP locale.
Réorienter sa responsabilité :
- soit stockage mémoire simple par screen
- soit helper minimal de publication en mémoire
- pas de fetch réseau sortant vers les devices

### 9. `lib/screenToCanvas.ts`
Créer ce fichier si utile pour debug / preview inverse.
But :
- conversion frame stockée -> représentation canvas
- rester compatible avec `canvasToScreen.ts`
- ne pas casser la conversion existante

### 10. Firmware ESP8266
Modifier le firmware existant, pas réécrire tout l'univers.

Nouveau flow minimal :
1. connexion WiFi
2. `POST /api/register`
3. stockage de `deviceId` + `pairCode`
4. affichage ou log du `pairCode`
5. boucle :
   - `POST /api/ping`
   - `GET /api/pull?deviceId=...`
   - render local du frame

Le firmware doit devenir client du serveur.
Le serveur ne doit plus contacter l'ESP directement.

---

## Important sur la sécurité

Le code actuel avec `ip`/`port` expose un risque de SSRF et ne doit plus rester la base de l'architecture.
La migration vers `register + ping + pull` est prioritaire avant toute suite du projet.

---

## Important sur la vision produit

Le projet futur est un réseau distribué de display nodes pour `Proof of Draw`.
Mais cette phase ne doit implémenter que l'infrastructure réseau de base :
- pairing
- register
- ping
- pull
- stockage mémoire des frames
- diffusion par type d'écran

Ne pas implémenter maintenant :
- blockchain
- wallet
- seed phrase
- rewards
- consensus
- Duino-Coin fork
- choix de gagnant
- hashing on-chain

---

## Rendu attendu de l'agent

Quand tu fais les modifications :
- donne les fichiers complets modifiés/créés
- respecte les chemins exacts
- n'invente pas une nouvelle arborescence
- n'ajoute pas de dépendances inutiles
- garde le projet buildable
- garde les types TypeScript cohérents
- privilégie des modifications minimales et ciblées