# Verdict matériel GPT — `ANIM-STREAM-FIX2` sur UNO R4 WiFi + TFT 2,8″

Date : 13 octobre 2026

## Verdict

**Canari matériel animation vert pour le chemin testé.** Le build annonce explicitement `POD_CANARY=1`, `AUCUN VOTE` et l'absence des routes de vote dans le binaire.

Une animation personnelle de 12 images (clip PBC1 de 7 707 octets) a suivi le parcours complet :

1. pull de la frame personnelle ;
2. téléchargement et affichage de 153 600 octets ;
3. cache SD et ACK HTTP 200 ;
4. téléchargement `/api/block-clip` HTTP 200 ;
5. retour complet de la transaction réseau ;
6. validation du clip depuis la SD ;
7. activation et lecture en boucle ;
8. plusieurs pulls concurrents sans reset ni fuite apparente ;
9. Reset matériel ;
10. restauration de la dernière œuvre et redécouverte du clip sur la SD.

Ce résultat valide matériellement la correction de `0059f74` : le tampon de validation de 2 048 octets n'est plus vivant pendant la transaction TLS. La validation ne commence qu'après le retour de `/api/block-clip`.

## Mesures observées

| Chemin | Utilisation | Marge | Verdict |
|---|---:|---:|---|
| pile réseau `pull-frame` | 1 324 o | 660 o | vert |
| pile réseau `block-clip` | 1 196 o | 788 o | vert |
| pile SD/TFT `animValidate` | 772 o | 700 o | vert |
| pile SD/TFT `animPlay` | 828 o | 644 o | vert |
| pile réseau HTTP au repos | 1 152 à 1 220 o | 764 à 832 o | vert |
| pile de travail JSON | 716 à 764 o | 1 220 à 1 268 o | vert |
| pile principale, pire valeur observée | 832 / 1 024 o | **192 o** | au-dessus du minimum 128 o, sous l'objectif 256 o |

Tas après chaque pull : environ 7 984 o libres, plus grand bloc 4 884 o, fragmentation 39 %. Pendant `animPlay`, 5 940 o restent libres. Les valeurs se répètent sur plusieurs cycles : aucune dérive progressive visible.

Après Reset : pile principale 220 à 236 o de marge sur le démarrage observé ; restauration SD réussie ; clip retrouvé et déclaré en lecture en boucle.

## Ce qui est désormais démontré

- téléchargement borné d'une frame TFT complète ;
- affichage et cache SD ;
- ACK seulement après succès ;
- téléchargement du clip vers la SD ;
- absence de chevauchement fatal entre TLS et tampon de validation ;
- validation en flux depuis la SD ;
- lecture répétée sans chargement complet du clip en RAM ;
- stabilité de plusieurs pulls pendant la lecture ;
- reprise après Reset depuis la SD ;
- aucune voie de vote dans le canari.

## Limites restantes

- La marge principale de 192 o est acceptable selon le seuil gelé de 128 o, mais reste inférieure à l'objectif de 256 o.
- Le journal prouve les chemins logiciels et mémoire, pas à lui seul la qualité visuelle. Le porteur doit confirmer que l'animation est effectivement visible et que le toucher affiche/masque le cartel sans interrompre durablement la lecture.
- Aucun vote réel n'est validé par ce canari.
- Ce verdict n'autorise pas encore la fusion dans `main` ni un déploiement général. Il satisfait toutefois la condition **V0** du plan d'audit du vote dès confirmation visuelle du toucher.

## Suite autorisée

Après confirmation visuelle :

1. déclarer V0 terminé ;
2. commencer V1 sur la branche de vote : harnais de bout en bout du code de vote actuel, sans modification fonctionnelle ;
3. garder le vote matériel, la production et l'archive SD distribuée bloqués jusqu'aux audits prévus.
