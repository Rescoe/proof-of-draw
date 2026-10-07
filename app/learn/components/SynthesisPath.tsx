import { Callout, Code, CodeBlock, Disclosure, SectionHeading } from "./ContentPrimitives";
import styles from "../learn.module.css";

// Synthèse technique de Proof-of-Draw (état au 06/10/2026). Vocabulaire HONNÊTE : chaque affirmation correspond à ce que le code fait aujourd’hui ;
// ce qui n’existe pas encore est dit comme tel et renvoyé à la feuille de route (en bas de la page).

const pipeline = [
  ["Dessiner", "Le navigateur (Pod Studio) produit une image pixel-exacte pour l’écran visé et enregistre la séquence de gestes. Le serveur la reçoit avec une session signée (HMAC-SHA256)."],
  ["Soumettre", "Le serveur rejette les séquences trop automatiques, calcule l’empreinte de l’image (SHA-256), celle des gestes et un score de dessin, puis publie UN candidat à la fois."],
  ["Annoncer", "Pour une image fixe, le candidat porte une spécification « v2 » : type d’écran, taille en octets et SHA-256 du contenu brut. Les cartes la lisent dans une réponse très légère."],
  ["Relire", "Chaque carte télécharge le contenu brut du candidat (octets exacts de l’écran, servis par un CDN) et le lit en flux : le firmware évite de recopier l’image dans un second buffer complet."],
  ["Recalculer", "Pendant la lecture, la carte calcule le SHA-256 et trois métriques entières. Elle décide d’un verdict objectif puis signe son vote en Ed25519."],
  ["Voter", "Le serveur vérifie la signature et refuse tout « accepte » dont le hash ou une métrique diffère d’un seul ppm. Le vote est écrit de façon atomique."],
  ["Miner", "Au quorum (51 % des appareils appairés actifs), le serveur crée le bloc, relié par hash au précédent, et tire au sort le mineur parmi les validateurs."],
  ["Afficher", "L’œuvre est diffusée aux écrans compatibles. Chaque carte récupère la frame au prochain contact, l’affiche (avec le cartel) puis accuse réception."],
];

const firmwares = [
  ["ESP8266", "e-ink 2,9″ BWR", "Oui", "Testé en réel"],
  ["ESP8266", "multiscreen e-ink 2,7″ + OLED", "Oui", "Testé en réel"],
  ["ESP8266", "TFT 1,8″", "Oui", "Testé en réel"],
  ["ESP8266", "e-ink 2,7″ seul", "Oui (code livré)", "À essayer"],
  ["UNO R4 WiFi", "e-ink 2,9″ BWR", "Oui", "Testé en réel"],
  ["UNO R4 WiFi", "e-ink 2,7″ seul · e-ink 2,7″ + OLED · TFT 1,8″", "Oui", "Testé en réel"],
  ["UNO R4 WiFi", "TFT 2,8″ tactile", "Oui (code livré)", "À essayer"],
];

const levels = [
  ["N0", "« N appareils étaient en ligne »", "Ancien fonctionnement : le vote recopiait le score du serveur.", "Encore le cas des animations et des appareils à firmware ancien."],
  ["N1", "Intégrité attestée : plusieurs appareils indépendants ont reçu ces octets exacts et signé leur hash", "Les cartes v2 le font pour les images fixes.", "Atteint partiellement : les votes anciens (écho) sont encore comptés, et les reçus signés ne sont pas conservés dans le bloc."],
  ["N2", "Règles objectives : format valide, image non uniforme, pas de bruit pur", "Appliquées par le firmware ; refus enregistrés mais non bloquants.", "Pas encore revérifiées par le serveur ; motif du refus non signé."],
  ["N3", "Authenticité du geste : le dessin a été tracé à la main", "Vérifiée par le serveur seul (rythme des gestes, replay).", "Pas encore refaisable par un tiers : phase « auditeurs » de la feuille de route."],
];

const glossary = [
  ["Candidat", "Dessin soumis, en attente de validation. Un seul à la fois."],
  ["Bloc", "Enregistrement permanent d’une œuvre validée : hash de l’image, des gestes, du bloc précédent, validateurs, score, date."],
  ["Quorum", "Nombre minimal de votes d’approbation : ⌈ 0,51 × appareils appairés actifs ⌉, au moins 1."],
  ["ppm", "Partie par million : les métriques sont des entiers entre 0 et 1 000 000, pour obtenir exactement le même résultat sur toutes les cartes."],
  ["Mineur", "Validateur tiré au sort (poids inverse du nombre de blocs déjà minés) qui reçoit la propriété du bloc. Tirage fait par le serveur."],
  ["Canari", "Essai volontairement limité d’une nouveauté avant de l’étendre."],
  ["OTA", "Mise à jour d’un firmware à distance, sans câble."],
];

export function SynthesisPath() {
  return (
    <section className={styles.majorSection} id="synthese">
      <SectionHeading eyebrow="Parcours 04" title="Synthèse de la technologie">
        <p>
          Tout Proof-of-Draw sur une seule page : ce que le système fait, comment les appareils calculent et votent, ce que la chaîne
          garantit et ce qu’elle ne garantit pas encore. Le travail restant est détaillé dans la feuille de route, tout en bas de la page.
        </p>
      </SectionHeading>

      <Disclosure title="En une page" id="synth-resume" open>
        <p>
          <strong>Proof-of-Draw</strong> est un réseau ouvert où des artistes dessinent dans un navigateur ; de petits ordinateurs
          (ESP8266, Arduino UNO R4 WiFi) <strong>relisent l’œuvre, recalculent son empreinte et des mesures de complexité, et signent leur
          vote</strong> ; l’œuvre rejoint alors une chaîne de blocs et s’affiche sur des écrans physiques (e-ink, OLED, TFT).
        </p>
        <Callout tone="success" title="Ce qui est réel aujourd’hui">
          <p>
            Pour une <strong>image fixe</strong>, plusieurs cartes ESP8266 et UNO R4 téléchargent les octets finaux, calculent un SHA-256 et trois
            métriques entières, puis signent leur verdict. Un essai réel à quatre appareils l’a confirmé le 6 octobre 2026.
          </p>
        </Callout>
        <Callout tone="warning" title="Ce que ce n’est pas (encore)">
          <p>
            Le système est aujourd’hui une <strong>chaîne de blocs centralisée, liée par hachage, alimentée par des attestations signées
            des appareils</strong>. Le serveur choisit le candidat, forme le quorum, tire le mineur et écrit l’unique registre. Ce n’est pas encore
            une blockchain décentralisée : voir « Ce que PoD n’est pas encore » et la feuille de route.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="Architecture : qui fait quoi" id="synth-archi">
        <div className={styles.synthTableWrap}>
          <table className={styles.synthTable}>
            <thead><tr><th>Élément</th><th>Rôle</th><th>Technologie</th></tr></thead>
            <tbody>
              <tr><td>Navigateur</td><td>Dessin pixel-exact, atelier d’animation, profil, vue Réseau</td><td>Next.js, canvas, moteur de dessin pur</td></tr>
              <tr><td>Serveur</td><td>Admission des candidats, quorum, chaîne, distribution des frames</td><td>Routes API Next.js sans état (Vercel)</td></tr>
              <tr><td>Registre</td><td>Candidat courant, votes, blocs, appareils (sans expiration pour les blocs)</td><td>Upstash Redis</td></tr>
              <tr><td>Appareil</td><td>Interroge le serveur, relit, calcule, signe, affiche</td><td>ESP8266 ou UNO R4 WiFi, Ed25519, SHA-256</td></tr>
              <tr><td>Écran</td><td>Affiche l’œuvre et son cartel</td><td>OLED 0,96″, e-ink 2,7″ / 2,9″, TFT 1,8″ / 2,8″</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Les appareils <strong>n’ouvrent jamais de port</strong> : ils appellent le serveur (architecture « pull »). Ils fonctionnent donc derrière
          n’importe quel routeur, sans exposer d’adresse locale.
        </p>
      </Disclosure>

      <Disclosure title="Du dessin au bloc, étape par étape" id="synth-pipeline">
        <div className={styles.protocolSteps}>
          {pipeline.map(([title, text], i) => (
            <div key={title}><span>{i + 1}</span><div><h4>{title}</h4><p>{text}</p></div></div>
          ))}
        </div>
      </Disclosure>

      <Disclosure title="Ce que les cartes calculent réellement" id="synth-calcul">
        <p>
          Chaque carte lit le contenu brut du candidat <strong>en flux</strong>, par petits morceaux, et met à jour ses compteurs au fur et à mesure.
          Elle n’a pas besoin d’un second buffer complet de l’image ; seuls l’OLED (1 Ko) et l’e-ink 2,9″ (4,7 Ko) utilisent un petit espace de travail borné,
          employé pendant la lecture. La durée totale, réseau compris, est relevée au port série. Chaque carte produit :
        </p>
        <CodeBlock>{`hash = SHA-256( octets bruts du contenu )
e = entropie binaire du taux de pixels allumés        (table fixe, en ppm)
t = proportion de voisins horizontaux/verticaux différents (ppm)
r = racine de (nombre de plages continues / nombre de pixels) (ppm)
score s = (4·e + 4·t + 2·r) / 10                       (ppm, plafonné à 1 000 000)

message signé = pod-vote-v2 | appareil | candidat | hash | version | e | t | r | verdict`}</CodeBlock>
        <p>
          Le calcul est entièrement <strong>entier</strong> (aucun nombre à virgule) pour que le serveur, l’ESP8266 et la R4 obtiennent
          <strong> exactement</strong> le même résultat. Cette parité est vérifiée par un test automatisé qui compile le code des cartes et le
          compare à la version TypeScript. Le <strong>verdict</strong> est « refuse » si le hash diffère, si l’image est uniforme (toute blanche ou
          toute pleine) ou si elle ressemble à du bruit pur ; sinon « accepte ». Aucun critère esthétique n’est jamais appliqué.
        </p>
        <div className={styles.synthTableWrap}>
          <table className={styles.synthTable}>
            <thead><tr><th>Carte</th><th>Variante d’écran</th><th>Vote recalculé</th><th>État</th></tr></thead>
            <tbody>{firmwares.map((row) => <tr key={row.join("|")}>{row.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <Callout tone="info" title="Ce que le calcul prouve, et ce qu’il ne prouve pas">
          <p>
            Il prouve que l’appareil <em>a lu</em> ces octets exacts et possède la clé qui signe. Il ne prouve ni que le dessin est fait à la main,
            ni que le calcul s’est déroulé sur un microcontrôleur plutôt que sur un PC. Le contenu étant public, la résistance aux faux appareils
            doit venir de l’identité (profil appairé, ancienneté, réputation), pas de la puissance de calcul.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="La chaîne de blocs et ses preuves" id="synth-chaine">
        <p>Un bloc contient :</p>
        <ul className={styles.powerList}>
          <li>l’<Code>imageHash</Code>, l’<Code>actionsHash</Code> et le score de dessin ;</li>
          <li>le <Code>parentHash</Code> (hash du bloc précédent), d’où la chaîne ;</li>
          <li>les identifiants des validateurs, le score, la date, l’artiste et le titre ;</li>
          <li>son propre <Code>blockHash</Code> = SHA-256 de l’ensemble canonique.</li>
        </ul>
        <p>
          Modifier un ancien bloc change tous les hash suivants : l’<strong>intégrité de l’historique</strong> est réelle. En revanche, les
          <strong> votes signés complets ne sont pas conservés</strong> dans le bloc (seul un résumé l’est) : un tiers ne peut pas, aujourd’hui,
          revérifier seul qu’un quorum a bien approuvé ces octets. Le code qui conserve ces reçus signés dans le bloc et le vérificateur public existent, mais sont éteints par défaut et pas encore essayés sur le réseau réel : tant qu’ils ne sont pas activés, la phrase ci-dessus reste vraie.
        </p>
      </Disclosure>

      <Disclosure title="Niveaux d’assurance : où en est-on ?" id="synth-niveaux">
        <div className={styles.synthTableWrap}>
          <table className={styles.synthTable}>
            <thead><tr><th>Niveau</th><th>Promesse</th><th>Ce qui existe</th><th>Limite actuelle</th></tr></thead>
            <tbody>{levels.map((row) => <tr key={row[0]}>{row.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p>
          Principe : les appareils attestent N1 et N2 (objectif, calculable, reproductible) ; N3 reste confié au serveur puis à des auditeurs plus
          puissants (navigateur, Raspberry Pi). Le réseau <strong>ne juge jamais le goût</strong>.
        </p>
      </Disclosure>

      <Disclosure title="Identité, signatures et sécurité" id="synth-secu">
        <ul className={styles.powerList}>
          <li><strong>Clés</strong> : chaque carte génère une paire Ed25519 au premier démarrage et la garde en mémoire permanente.</li>
          <li><strong>Votes v2</strong> : la signature est obligatoire et couvre l’appareil, le candidat, le contenu, les métriques et le verdict.</li>
          <li><strong>Vote atomique</strong> : un script Redis enregistre chaque vote d’un seul tenant ; un double vote est ignoré.</li>
          <li><strong>Session du navigateur</strong> : cookie signé qui prouve la possession d’un écran, sans compte ni mot de passe.</li>
          <li><strong>Mémoire des cartes</strong> : l’ESP8266 n’a qu’environ 80 Ko ; le chiffrement de la connexion en réclame une grande part, d’où le calcul en flux.</li>
        </ul>
        <Callout tone="warning" title="Limites connues, listées dans la feuille de route">
          <p>
            Un appareil non appairé peut encore voter ; le vote est compté par appareil et non par profil ; l’auteur n’est pas exclu du vote sur son œuvre ;
            l’enregistrement d’un appareil ne demande pas de preuve de possession de la clé ; les connexions des cartes n’authentifient pas le serveur ;
            la clé de l’ESP8266 est générée avec une source d’aléa à renforcer. Aucun élément matériel sécurisé n’existe sur ces cartes : l’identité sera donc
            liée à un propriétaire, pas à un matériel certifié.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="Animations" id="synth-anim">
        <p>
          Une animation suit le même parcours qu’un dessin : atelier plein écran (3 modes, 7 brosses, fantôme avant/après), clip compact « PBC1 »
          de 128×64 en 1 bit (9 Ko au plus, images codées en différences), candidat, votes, bloc de type animation, puis diffusion automatique aux
          écrans dynamiques (TFT 2,8″, TFT 1,8″, OLED) dont le firmware sait la jouer ; jamais aux e-ink.
        </p>
        <Callout tone="warning" title="Affichage dynamique ≠ validation dynamique">
          <p>
            Aujourd’hui, les animations sont encore votées en <strong>v1 (écho du score du serveur)</strong>. Les valider par calcul (racine, empreinte et
            métriques de chaque image) est un chantier de la feuille de route.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="Écrans, formats et contraintes" id="synth-ecrans">
        <div className={styles.synthTableWrap}>
          <table className={styles.synthTable}>
            <thead><tr><th>Écran</th><th>Grille de calcul</th><th>Contenu brut</th></tr></thead>
            <tbody>
              <tr><td>OLED 0,96″</td><td>128 × 64, 1 bit</td><td>1 024 o</td></tr>
              <tr><td>e-ink 2,7″ noir/blanc</td><td>176 × 264, 1 bit</td><td>5 808 o</td></tr>
              <tr><td>e-ink 2,9″ noir/blanc/rouge</td><td>128 × 296, deux plans</td><td>9 472 o</td></tr>
              <tr><td>TFT 1,8″</td><td>128 × 160, RGB565</td><td>40 960 o</td></tr>
              <tr><td>TFT 2,8″ tactile</td><td>240 × 320, RGB565</td><td>153 600 o</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Cartels e-ink</strong> : le firmware grave l’heure, l’artiste et le titre dans les bandes haute et basse après avoir reçu l’image. Sur
          l’e-ink 2,9″, cela masque environ 22 % de la hauteur ; une zone sûre puis un réglage par appareil sont prévus.
        </p>
      </Disclosure>

      <Disclosure title="Coûts et garde-fous" id="synth-couts">
        <ul className={styles.powerList}>
          <li><strong>Quotas Redis</strong> : toute nouveauté est chiffrée en commandes par heure avant d’être codée ; lectures groupées, cadence adaptative (5 minutes en activité, 15 au repos), contenu des candidats servi par un CDN.</li>
          <li><strong>Mémoire ESP8266</strong> : les tampons d’image destinés à l’affichage sont alloués après la fermeture de la connexion chiffrée ; pour la validation, un espace de travail borné (1 à 4,7 Ko selon l’écran) sert pendant la lecture en flux ; messages en mémoire flash ; relevé du tas au démarrage.</li>
          <li><strong>Mémoire UNO R4</strong> : tampons statiques seulement, pile principale d’un kilo-octet.</li>
          <li><strong>Secrets</strong> : les identifiants Wi-Fi vivent dans un fichier local ignoré par git, jamais dans les sketches publiés.</li>
        </ul>
      </Disclosure>

      <Disclosure title="Ce que PoD n’est pas (encore)" id="synth-pas">
        <ul className={styles.powerList}>
          <li>Une blockchain <strong>décentralisée</strong> : un registre unique, un serveur qui choisit candidat, quorum et mineur.</li>
          <li>Un consensus <strong>résistant aux identités multiples</strong> : le vote est par appareil, pas par profil.</li>
          <li>Un <strong>taux de menteurs mesuré</strong> : aucune réputation persistante n’existe ; seul un drapeau « suspect » temporaire.</li>
          <li>Une <strong>validation des animations par calcul</strong>.</li>
          <li>Une <strong>preuve que le dessin est fait à la main</strong> vérifiable par un tiers.</li>
          <li>Un système à <strong>mise à jour à distance</strong> : chaque carte se reflashe encore par câble.</li>
        </ul>
        <p>Chacun de ces points est une ligne de la feuille de route, avec son statut.</p>
      </Disclosure>

      <Disclosure title="Glossaire" id="synth-glossaire">
        <dl className={styles.synthGlossary}>
          {glossary.map(([term, def]) => (
            <div key={term}><dt>{term}</dt><dd>{def}</dd></div>
          ))}
        </dl>
      </Disclosure>
    </section>
  );
}
