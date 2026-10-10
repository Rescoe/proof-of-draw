# Audit GPT — `231393d` : register et pull JSON validés matériellement sur trois pulls

| Champ | Valeur |
|---|---|
| Date | 10/10/2026 |
| Commit essayé | `231393d`, drapeaux locaux `POD_RENDER_V1=1`, `POD_CANARY=1` |
| Matériel | UNO R4 WiFi + e-ink 2,9 pouces BWR |
| Verdict register JSON | **ACCEPTÉ matériellement** |
| Verdict pull JSON | **ACCEPTÉ matériellement, trois pulls sans frame** |
| Verdict global | **Canari sans frame réussi ; ne pas encore déclencher de vote ou de frame avant migration de `doValidate`** |
| Redis / Neon | Redis +0, Neon 0 |

## 1. Résultats

### Piles dédiées

| Sous-système | Utilisation observée | Marge minimale observée | Statut |
|---|---:|---:|---|
| Ed25519 | verify 1 532 o | 708 o | erreur 0 |
| Wi-Fi | 448 à 608 o | 864 o | erreur 0 |
| PodNet | 1 136 à 1 172 o | 812 o | erreur 0 |
| Journal | 416 o | 1 056 o | erreur 0 |
| Register JSON | 448 o | 1 536 o | erreur 0, statut 1 |
| Pull JSON 1 | 724 o | 1 260 o | erreur 0, statut 1 |
| Pull JSON 2 | 652 o | 1 332 o | erreur 0, statut 1 |
| Pull JSON 3 | 620 o | 1 364 o | erreur 0, statut 1 |

Toutes les piles dédiées dépassent largement l'objectif de 256 octets.

### Pile principale

- après inscription : 784 / 1 024 octets, marge 240 ;
- après premier pull : 892 / 1 024 octets, marge 132 ;
- les pulls suivants ne déclenchent aucun contrôle fatal silencieux ;
- marqueur et longueur peinte restent intacts ;
- aucune phase fautive n'est rapportée.

La marge de 132 octets n'est que 4 octets au-dessus du minimum canari de 128 et reste sous l'objectif de 256. Le canari est toutefois plus lourd que la production (`doPull` instrumenté), et la valeur reste stable sur les trois cycles. Ce résultat est accepté pour le chemin sans frame de cette carte, sans généralisation aux autres firmwares.

## 2. Tas : absence de fuite cumulative sur les pulls répétés

| Pull | Avant le travail JSON | Après le travail JSON |
|---|---:|---:|
| 1 | 6 112 o | 6 008 o |
| 2 | 6 008 o | 5 924 o |
| 3 | 6 008 o | 5 924 o |

Les deuxième et troisième pulls ont exactement le même profil. La baisse initiale correspond aux chaînes persistantes et aux résultats du premier traitement ; elle ne se poursuit pas au troisième cycle. Le tas après retour complet de `doPull` était remonté à 6 820 octets au premier cycle. Aucune fuite cumulative n'est observée sur ce canari.

## 3. Ce que ce canari valide

- inscription, réponse JSON d'inscription et application du résultat ;
- transaction `/api/pull` et décodage complet sans frame ;
- répétition de trois pulls avec le même bloc/cartel ;
- séparation TLS puis travail JSON ;
- protections NOMEM/NESTED/GUARD/MARGIN non déclenchées ;
- stabilité du tas sur les pulls 2 et 3 ;
- absence de nouveau polling et de coût Redis/Neon ajouté.

## 4. Ce qu'il ne valide pas

- `doValidate` et un vote réel ;
- réception et rendu d'une frame ;
- `frameHash`, `renderHash`, BUSY et ACK ;
- animation v3 ;
- OTA ;
- autres firmwares R4 ou ESP8266 ;
- TFT 2,8 pouces, toujours bloqué par sa marge de vote de 60 octets.

## 5. Étape suivante obligatoire : `DOVALIDATE-JSON-STACK-FIX1`

Avant tout dessin susceptible de faire apparaître un candidat, migrer le dernier parseur ArduinoJson de la voie de vote e-ink 2,9 pouces sur `podWorkRun` :

1. transaction `/api/validate-candidate` complètement fermée avant le parseur ;
2. `JsonDocument`, `deserializeJson`, lectures et conversions sur pile de travail ;
3. structure de sortie bornée hors pile principale ;
4. aucun changement de `pendingCandidateId`, signature, métrique, vote ou requête POST avant résultat complet ;
5. échec fermé sur toute erreur de pile, JSON, type ou borne ;
6. couvrir les chemins v1, v2, déjà voté, candidat absent et réponse malformée ;
7. ligne canari `validate JSON` avec utilisation, marge, erreur, statut et tas ;
8. compilation cœurs 1.5.3 et 1.6.0, tests hôte et mutants ;
9. aucun changement serveur, Redis, Neon, protocole, polling ou OTA.

Après cette migration et son audit, un dernier canari sans candidat doit précéder l'envoi d'une frame personnelle unique.

## 6. Décision opérationnelle

La carte peut être débranchée : le canari `register + trois pulls sans frame` est terminé. Ne pas envoyer de frame avec ce firmware et ne pas publier encore l'archive comme firmware final complet. La suite est la sécurisation de `doValidate`.
