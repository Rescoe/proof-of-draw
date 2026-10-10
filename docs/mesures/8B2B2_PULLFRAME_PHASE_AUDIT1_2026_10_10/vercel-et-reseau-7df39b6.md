# Journaux Vercel / PoD du canari 7df39b6 (10/10/2026) — extrait transmis par le porteur

**Fenêtre du journal Vercel fournie : 13:41:00 → 14:11:00** (axe de la capture : 13:41:00, 13:49:40, 13:57:50, 14:11:00). ⚠ La frame personnelle a été envoyée AVANT 13:41 (elle précède le dessin de 13:42:24) : **l'absence de `/api/pull-frame` dans cette fenêtre ne prouve pas à elle seule qu'aucune requête n'est partie plus tôt** ; la preuve principale reste le journal série (aucun « [HTTP GET] /api/pull-frame »). À compléter par un extrait Vercel filtré sur `/api/send-to-screen` et `/api/pull-frame` pour 13:00 → 13:45.

## Événements du consensus (extrait fidèle, heures locales)
| Heure | Requête | Statut | Message |
|---|---|---|---|
| 13:42:23.24 | GET /api/draw-status | 200 | |
| 13:42:23.91 | POST /api/draw | 200 | |
| 13:42:24.74 | POST /api/submit-candidate | 200 | `candidat créé id=9964161f-13e8-4dd3-9710-79e281bc3024 poolSize=4 score=0.001 drawScore=15 actionsHash=501147577534...` |
| 13:43:35.67 | GET /api/validate-candidate | 200 | |
| 13:43:37.22 | POST /api/validation-result | 200 | `vote device=dev_T46HBXG1 votes=1/3 quorum=false` |
| 13:46:15.72 | POST /api/register | 200 | `pool ok device=dev_KAD6PKC4 screens=oled096,eink27bw` |
| 13:46:49.03 | GET /api/validate-candidate | 200 | |
| 13:46:50.27 | GET /api/candidate-frame | 200 | |
| 13:46:52.07 | POST /api/validation-result | 200 | `vote device=dev_KAD6PKC4 votes=2/3 quorum=false` |

* Aucune ligne `/api/pull-frame`, `/api/ack-frame` ni `/api/send-to-screen` dans la fenêtre fournie.
* Aucun vote de `dev_W29I1TW7` (le R4) : le troisième vote n'est jamais arrivé ; quorum = max(1, ceil(4 × 0,51)) = 3 → aucun bloc publié, le candidat expire (≈ 30 min).
* Le reste de l'extrait : `/api/pull` et `/api/validate-candidate` répétés (autres appareils), `/gallery`, `/`, `/api/network/*`, `[anaFeed] HTTP 200 — 3 item(s)`.

## Journal d'activité PoD (page réseau)
```
13:42:25  VALIDATE  esp-eink29bwr ▸ candidateId=9964161f-1… score=15.000 (2/4 votes)
13:43:37  VALIDATE  esp-eink29bwr ▸ Vote v1 · écho du score serveur (non vérifié) · score=0.34
13:46:52  VALIDATE  esp-eink29bwr ▸ Vote v2 ✓ accepte · e=657526 t=71106 r=264317
```
Ces trois lignes concernent d'autres appareils (`dev_T46HBXG1` v1 écho, `dev_KAD6PKC4` v2). Rien d'autre pendant ≈ 30 minutes.
