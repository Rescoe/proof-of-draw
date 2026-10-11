# Audit GPT — canari PULLFRAME-PHASE-AUDIT4 (fd8b1dc) : lecture du journal `gen=3` ; hypothèse « abort() » ; instruction du lot AUDIT5 (11/10/2026)

Transcription des deux analyses transmises par le porteur (texte tel que reçu, mis en forme).

## 1. Lecture du journal `gen=3`

AUDIT4 fonctionne et réduit encore fortement la zone du problème. Le journal précédent `gen=3` dit `DERNIERE PHASE 9`, puis `R3 Z4 C4 K5 / R5 Z6 C6 K6 / R12 Z13 C13 K14 / R26 Z27 C27 K28`. Interprétation :

- `read()` est appelé et revient avec zéro octet (`R → Z`) ;
- `connected()` est appelé et répond encore vrai (`C → K`) ;
- le temps avance au moins jusqu'à environ `28 × 8 = 224 ms` ;
- aucun octet d'en-tête HTTP n'arrive ;
- `readHeaders()` ne revient jamais ; la phase 10 n'est jamais atteinte.

Cela écarte un blocage immédiat dans le premier `read()` ou le premier `connected()`. Le gel arrive ensuite : dans un appel ultérieur, dans `delay(2)`, dans une écriture flash de l'instrument, ou à la suite d'une faute.

Consigne : ne pas faire Reset tout de suite ; regarder la matrice LED pendant que la carte est figée, noter ou photographier les LED allumées par rapport au test séquentiel F, R, C, A, H. Lecture immédiate : `A + R` = blocage dans un appel ultérieur à `read()` ; `A + C` = dans `connected()` ; `A + F` = l'instrument s'est bloqué en écrivant un événement ; `A` seule = entre les appels (probablement `delay(2)`, horloge/interruptions ou faute) ; `A + H` = les en-têtes ont finalement été lus (contredirait le journal) ; aucune LED = matrice non fiable ou redémarrage. Puis : attendre deux minutes, un seul Reset, copier le début jusqu'à `FFLOG legende`, chercher `/api/pull-frame` dans Vercel à l'heure exacte de ce test.

Message à transmettre : « AUDIT4 matériel confirmé. Journal précédent `gen=3` : 34 éléments, dernière phase 9. Les quatre derniers échantillons sont `R→Z` puis `C→K`, aux temps 3–5, 5–6, 12–14 et 26–28 unités de 8 ms. Les appels échantillonnés à `read()` reviennent avec 0 octet, `connected()` revient vrai et l'horloge avance jusqu'à environ 224 ms. Aucun `T1`, aucune phase 10. Je relève les LED avant Reset, puis je fournirai le journal `gen=4` et les logs Vercel `/api/pull-frame`. Ne corrigez rien avant ces trois informations. »

## 2. Hypothèse abort() (de Claude, reprise par GPT) et instruction AUDIT5

L'hypothèse de Claude est techniquement sérieuse et correspond très bien au moment du blocage, mais elle n'est pas encore démontrée. Scénario : (1) les seize premiers `read()` ne reçoivent rien ; (2) vers 224 ms la réponse binaire commence à arriver ; (3) le cœur WiFiS3 accumule un bloc dans une `std::string` ; (4) son agrandissement demande une allocation contiguë ; (5) malgré plusieurs kilo-octets libres au total, le tas fragmenté ne fournit pas le bloc demandé ; (6) `operator new` appelle `abort()` ; (7) `_exit` boucle indéfiniment, sans reset ni message. Cela expliquerait : pourquoi les petites réponses JSON fonctionnent, pourquoi la grande réponse `/api/pull-frame` bloque, pourquoi le firmware reste silencieux, pourquoi la connexion semblait saine juste avant, pourquoi aucune limite de temps ne peut agir (le programme n'est plus dans la boucle de timeout).

Action immédiate (porteur) : avant tout Reset, photographier la matrice LED, indiquer quelles LED restent allumées par rapport au test F, R, C, A, H ; attendre deux minutes ; un seul Reset ; copier le nouveau `FFLOG demarrage precedent` ; chercher `/api/pull-frame` dans Vercel. Si les LED restantes sont `A + R`, l'hypothèse d'un blocage à l'intérieur de `read()` devient très forte. Si AUDIT5 enregistre ensuite la signature `abort`, elle sera démontrée.

**AUDIT5 accepté en principe après collecte des LED, du journal `gen=4` et de Vercel.** Le remplacement d'`abort()` doit être strictement réservé à `POD_RENDER_V1 && POD_CANARY`. Dans `abort()` : aucune allocation ; aucun `String` ; ni `logf` ni Serial ; aucune exception ; aucune fonction susceptible de reprendre un verrou du tas ; écrire seulement une signature fixe dans le journal flash déjà réservé ; allumer une LED dédiée ; terminer par une boucle infinie explicite. Ne pas appeler `mallinfo()` depuis `abort()` tant qu'il n'est pas prouvé sans allocation et sans verrou : enregistrer plutôt les métriques de tas immédiatement avant l'entrée dans les appels `read()` échantillonnés. Ajouter au journal : tas libre, espace `sbrk → StackLimit` et, si accessible sans allocation, taille du plus grand bloc libre avant le `read`. Aucun correctif de production avant confirmation ; aucun changement serveur, Redis, Neon, protocole, polling ou format de frame.

Si cette piste est confirmée : le problème ne serait ni le rendu, ni l'e-ink, ni le serveur, ni TLS lui-même, mais une allocation cachée dans la bibliothèque WiFiS3 pendant la réception d'un bloc binaire — un défaut précis pour lequel on pourra construire un contournement borné.

## 3. Observation du porteur (message suivant)

« Sans vouloir dire de bêtise, il me semble que les 1 et 3 restent allumés sur l'ordre » (LED du test séquentiel F, R, C, A, H).

## Remarques de l'implémentation (Claude)

- **Lecture de l'observation** : « 1 et 3 » = F et C si l'on compte depuis 1 sur les cinq LED du test ; c'est IMPOSSIBLE par construction (la LED A reste allumée de la marque 1 à la 15 et F/C ne peuvent pas être allumées ensemble). Si le premier allumage du test (F) n'a pas été vu — il a lieu pendant le démarrage — les LED vues sont R, C, A, H et « 1 et 3 » = R et A = **A + R**, qui est exactement la signature attendue d'un blocage dans `read()`. À confirmer par une vidéo du test séquentiel (AUDIT5 ajoute un repère « toutes les LED ensemble »).
- **Pas de `set_new_handler`** : le binaire montre que `operator new(nothrow)` appelle le gestionnaire d'allocation s'il existe ; en installer un détournerait les chemins « échec = rejet » (`new (std::nothrow)`) des décodeurs. Seule `abort()` est redéfinie.
- **Plus grand bloc libre** : la `mallinfo` de la bibliothèque C du cœur ne renseigne que l'arène et le total libre (`fordblks`) ; la liste libre n'est pas accessible sans allocation. Sont journalisés : tas libre total et sommet vierge (`sbrk(0)` jusqu'à `__StackLimit`), en unités de 32 o.
