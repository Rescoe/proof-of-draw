# Journal matériel du premier canari TFT 2,8″ — chiffres du verdict GPT/Codex (archivés tels que fournis)

⚠ Le **texte brut** du journal série n'a PAS été joint à la demande de FIX2 : seuls les chiffres ci-dessous, rapportés par le verdict, sont archivés. Ils ne sont pas reconstitués ni complétés.

| mesure | valeur |
|---|---|
| pile principale avant / après Wi-Fi | 788 / 1 024 o (marge 236) |
| `PodEd` sign | 1 316 o utilisés, marge 924 |
| `PodEd` verify | 1 532 o utilisés, marge 708 |
| `PodNet` register | 1 180 o utilisés, marge 804 |
| JSON de `/api/register` | 496 o utilisés, marge 1 488, statut 1 |
| `POST /api/register` | 200 ; appareil appairé |
| **au retour de `doRegister`** | **916 / 1 024 o utilisés, marge 108 o (< 128)** ; marqueur et longueur intacts, SP dans la pile |
| conséquence | arrêt préventif du canari, sans corruption ; aucune frame envoyée ni testée |
