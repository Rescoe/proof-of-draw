import { Blocks, Bot, CircleGauge, KeyRound, Network, Scale, Server, ShieldCheck, Vote } from "lucide-react";
import { Callout, Code, CodeBlock, Disclosure, SectionHeading } from "./ContentPrimitives";
import { FlowDiagram } from "./FlowDiagram";
import styles from "../learn.module.css";

const roles = [
  {
    icon: CircleGauge,
    label: "Artiste",
    title: "Créateur du dessin",
    description: "Dessine dans le navigateur et soumet son œuvre avec son propre ESP ou un écran public partagé.",
    details: ["POST /api/draw", "Session signée HMAC-SHA256", "Détection des séquences automatisées"],
  },
  {
    icon: Vote,
    label: "Validateur",
    title: "Nœud de consensus",
    description: "L’ESP interroge le serveur, relit le contenu du candidat, recalcule son hash et des métriques entières, puis signe son vote (images fixes ; les animations sont encore votées en v1).",
    details: ["GET /api/pull", "GET /api/validate-candidate", "POST /api/validation-result"],
  },
  {
    icon: Blocks,
    label: "Mineur",
    title: "Finalisation d’un bloc",
    description: "Un validateur est tiré au sort par le serveur à chaque quorum et son compteur de blocs minés est mis à jour.",
    details: ["Tirage pondéré inverse", "chain:notify:{deviceId}", "Tirage non encore rejouable par un tiers"],
  },
  {
    icon: Server,
    label: "Serveur",
    title: "Orchestrateur",
    description: "L’application Next.js et Redis coordonnent les soumissions, la chaîne et la distribution des frames.",
    details: ["Next.js API Routes", "Upstash Redis", "chain:recent · candidate:current"],
  },
];

const strengths = [
  {
    icon: Network,
    title: "Aucune IP locale exposée",
    description: "Les ESP ne sont jamais contactés directement. Ils interrogent le serveur et fonctionnent derrière un routeur ou un NAT.",
    meta: "GET /api/pull · frame:{deviceId}",
  },
  {
    icon: Blocks,
    title: "Chaîne vérifiable",
    description: "Chaque bloc contient le hash SHA-256 du précédent et les blocs sont conservés sans expiration.",
    meta: "chain:block:{hash} · parentHash",
  },
  {
    icon: Bot,
    title: "Résistance aux automatismes",
    description: "Le serveur détecte les séquences d’actions trop rapides ; cette vérification du geste reste, pour l’instant, une vérification du serveur.",
    meta: "automationRatio · MAX_AUTOMATION_RATIO",
  },
  {
    icon: Scale,
    title: "Minage équitable",
    description: "Le mineur est tiré au sort avec un poids inversement proportionnel aux blocs déjà minés.",
    meta: "WEIGHT_BASE / (blocs + 1)",
  },
  {
    icon: KeyRound,
    title: "Authentification sans mot de passe",
    description: "La session du navigateur est signée et prouve la possession du device sans compte ni seed phrase.",
    meta: "HMAC-SHA256 · cookie httpOnly",
  },
  {
    icon: ShieldCheck,
    title: "Seuils adaptatifs",
    description: "Les critères de qualité s’adaptent à l’historique du réseau pour chaque type d’écran.",
    meta: "getEffectiveThresholds()",
  },
];

export function ExpertDocumentation() {
  return (
    <section className={styles.majorSection} id="reseau">
      <SectionHeading eyebrow="Parcours 03" title="Comprendre le réseau">
        <p>
          Cette partie rassemble la vue technique du protocole. Elle est indépendante du tutoriel de branchement et peut être lue comme un white paper synthétique.
        </p>
      </SectionHeading>

      <section className={styles.expertSection} id="how">
        <h3>Comment une œuvre traverse le réseau</h3>
        <p>
          Proof-of-Draw utilise une architecture <strong>pull-based</strong> : les ESP interrogent toujours le serveur,
          jamais l’inverse. Ils restent ainsi utilisables derrière n’importe quel routeur ou NAT sans exposer d’adresse locale.
        </p>
        <FlowDiagram />

        <Disclosure title="Séparation entre le pull léger et le téléchargement binaire">
          <p>
            Pour préserver la mémoire disponible sur l’ESP8266, <Code>GET /api/pull</Code> ne renvoie que des métadonnées.
            Le payload de l’image est récupéré uniquement lorsqu’un nouveau <Code>frameId</Code> est détecté.
          </p>
          <div className={styles.payloadGrid}>
            <div>
              <strong>GET /api/pull</strong>
              <p>Métadonnées légères indiquant l’action à effectuer.</p>
              <CodeBlock>{`{
  "frameSource": "consensus",
  "frameId": "abc…",
  "pendingValidation": { "candidateId": "xyz…" }
}`}</CodeBlock>
            </div>
            <div>
              <strong>GET /api/pull-frame?fmt=bin</strong>
              <p>Payload binaire téléchargé seulement lorsqu’une nouvelle frame est disponible.</p>
              <CodeBlock>{`Content-Type: application/octet-stream
Payload adapté au profil de l’écran`}</CodeBlock>
            </div>
          </div>
        </Disclosure>
      </section>

      <Disclosure title="Les rôles du réseau" id="roles" open>
        <p>Chaque participant peut jouer un ou plusieurs rôles simultanément. Un même ESP peut être validateur, mineur et afficheur.</p>
        <div className={styles.roleGrid}>
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <article key={role.label}>
                <Icon size={20} aria-hidden />
                <span>{role.label}</span>
                <h4>{role.title}</h4>
                <p>{role.description}</p>
                <ul>{role.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              </article>
            );
          })}
        </div>
        <Callout title="Mode prêt public">
          <p>
            Un artiste peut partager son ESP. Le propriétaire reste associé au device et le dessinateur est crédité via
            <Code> drawArtistName</Code> dans le bloc.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="Protocole de consensus" id="consensus">
        <div className={styles.protocolSteps}>
          <div><span>1</span><div><h4>Soumission</h4><p>
            <Code>POST /api/draw</Code> encode le canvas en 1 bit par pixel pour les e-ink et OLED, ou en RGB565 little-endian pour le TFT.
            Le serveur vérifie la session, applique les limites et publie le candidat.
          </p></div></div>
          <div><span>2</span><div><h4>Vote des ESP</h4><p>
            Les validateurs détectent le candidat, téléchargent son contenu brut, recalculent le SHA-256 et les métriques entières (entropie, transitions, runs),
            signent leur verdict puis l’envoient à <Code>POST /api/validation-result</Code>. Le serveur refuse tout « accepte » dont le hash ou une métrique diffère.
          </p></div></div>
          <div><span>3</span><div><h4>Quorum et bloc</h4><p>
            Le quorum correspond à <Code>⌈ poolSize × 0,51 ⌉</Code> approbations (appareils appairés actifs), avec un minimum d’un vote. Le serveur finalise le bloc,
            relie son hash au bloc précédent et conserve l’image et ses métadonnées.
          </p></div></div>
          <div><span>4</span><div><h4>Sélection du mineur</h4><p>
            Le mineur n’est pas le plus rapide. Il est tiré au sort parmi les validateurs avec le poids
            <Code> WEIGHT_BASE / (blocksMinés + 1)</Code>, ce qui favorise les nouveaux participants.
          </p></div></div>
        </div>
        <Callout title="Comparaison des scores">
          <p>
            Un vote v2 doit reproduire exactement le calcul du serveur ; un refus signé est enregistré mais, pendant la phase d’essai, ne bloque pas le candidat.
            Voir la synthèse (parcours 04) pour le niveau d’assurance réellement atteint.
          </p>
        </Callout>
      </Disclosure>

      <Disclosure title="Solidité technique" id="why">
        <div className={styles.strengthGrid}>
          {strengths.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title}>
                <Icon size={20} aria-hidden />
                <div><h4>{item.title}</h4><p>{item.description}</p><code>{item.meta}</code></div>
              </article>
            );
          })}
        </div>
      </Disclosure>

      <Disclosure title="Licences et droits" id="licence">
        <div className={styles.licenceGrid}>
          <article>
            <span>Code source</span>
            <h4>Licence MIT</h4>
            <p>
              Le code du serveur, les firmwares et les bibliothèques peuvent être utilisés, modifiés, redistribués et forkés,
              y compris commercialement, sous réserve de conserver la notice de licence.
            </p>
          </article>
          <article>
            <span>Œuvres</span>
            <h4>Licence CC0</h4>
            <p>
              Un dessin soumis est placé dans le domaine public universel. Il est librement partageable, réutilisable et modifiable sans condition.
            </p>
          </article>
        </div>
        <p>
          CC0 ne signifie pas anonymat : le nom d’artiste, le hash du dessin et la date restent associés à l’œuvre dans la chaîne.
          La liberté de réutilisation et la traçabilité de l’origine coexistent.
        </p>
      </Disclosure>
    </section>
  );
}
