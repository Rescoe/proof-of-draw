# Preuves — canari ACK matériel du TFT 2,8″ et bloc #104 (15/10/2026)

Ce dossier distingue ce qui est BRUT, ce qui est EXTRAIT du brut, et ce qui est TRANSCRIT.

| Fichier | Nature | Fidélité |
|---|---|---|
| (hors dépôt) `redis-monitor (4).csv` | **CSV brut** exporté par le porteur, 666 476 octets, 573 lignes de données ; SHA-256 `a64dc1921287acf2ed2af141162ab4b3cdd9c7856e596f0bf351ec8e50de3b00` | brut — **non commité** : il contient des adresses IP, des adresses MAC et des codes d'appairage |
| `bloc_104.json` | **extrait du CSV brut** : le bloc #104 tel qu'écrit par la commande `SET chain:block:ae6f263b…` de 09:14:03.210 (état APRÈS la mise à jour d'observation), mis en forme (indentation) sans modification de valeur | fidèle (JSON décodé du champ CSV) |
| `chronologie_csv_ASSAINIE.md` | **synthèse assainie** du CSV brut (IP, MAC, pairCode omis) | extraction + interprétation signalée |
| `journal_serie_TFT28_TRANSCRIPTION.txt` | **TRANSCRIPTION** du moniteur série collée dans la conversation | le **journal brut n'est pas disponible** ; aucune ligne antérieure à « [FRAME] 320/320 lignes » ; aucun horodatage |

## Ce que les preuves établissent
- **Canari ACK matériel (TFT)** : frame complète (320/320 lignes), `POST /api/ack-frame -> 200`, `[ACK] … -> OK`, journal `— ACK recu (HTTP 200)` (libellé propre à TFT28-ACK-STATE-FIX1 : le firmware flashé contient le correctif), pulls suivants `aucune frame`. Côté serveur (CSV) : `shown:dev_7B4L17N3:tft28` écrit avec le frameId du bloc. **Non établi** : ce qui se passe quand l'ACK ÉCHOUE sur la carte (le chemin d'échec n'a été exercé que sur l'hôte).
- **Bloc #104** : `votesSummary = {v2: 2, v1: 0, rejects: 0}` ; `validatorIds = [dev_7B4L17N3 (TFT 2,8″, auteur), dev_MN67OG7R (ESP8266 e-ink 2,9″)]` ; `poolSize` du candidat non reproduit ici (absent du bloc) ; `minedAt` = 2026-10-15T07:11:28.173Z. Le multiscreen `dev_KAD6PKC4` figure comme **observateur** (`revalidated`), pas comme votant.
- **Délais** : dépôt → minage ≈ 12 min 05 s ; minage → ACK du TFT ≈ 4 min 07 s (voir la chronologie). Le délai de minage correspond au réveil des ESP8266 (≈ 15 min au repos) ; `PULL_DORMANT_SEC` n'est **pas** modifié par ce lot (décision du porteur/GPT).
- Le TFT a voté sur son propre dessin (éligibilité des votants éteinte : voir `docs/RESTE_A_FAIRE_2026_10_14.md`, § E).

## Reproduire la vérification
```bash
sha256sum "redis-monitor (4).csv"     # doit donner a64dc1921287acf2ed2af141162ab4b3cdd9c7856e596f0bf351ec8e50de3b00
```
puis rechercher la ligne `09:14:03.210` (`SET chain:block:ae6f263b…`) : son contenu doit coïncider avec `bloc_104.json`.
