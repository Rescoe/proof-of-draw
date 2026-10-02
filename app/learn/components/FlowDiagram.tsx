import styles from "../learn.module.css";

const nodes = [
  {
    actor: "Artiste",
    meta: "POST /api/draw",
    items: ["Dessine dans le navigateur", "Soumet le dessin au réseau"],
  },
  {
    actor: "Serveur",
    meta: "candidate:current → Redis",
    items: ["Encode le dessin pour l’écran", "Calcule sa complexité", "Publie le candidat"],
  },
  {
    actor: "ESP validateurs",
    meta: "GET /api/pull · POST /api/validation-result",
    items: ["Détectent le candidat", "Calculent les métriques", "Soumettent leurs votes"],
  },
  {
    actor: "Finalisation",
    meta: "chain:block:{hash}",
    items: ["Vérifie le quorum", "Grave le bloc SHA-256", "Sélectionne le mineur"],
  },
  {
    actor: "Écrans",
    meta: "GET /api/pull-frame",
    items: ["Détectent la nouvelle frame", "Téléchargent le payload", "Affichent l’œuvre"],
  },
];

export function FlowDiagram() {
  return (
    <div className={styles.flowDiagram} aria-label="Flux d’un dessin dans le réseau Proof-of-Draw">
      {nodes.map((node, index) => (
        <div className={styles.flowItem} key={node.actor}>
          <div className={styles.flowNode}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{node.actor}</strong>
              <ul>{node.items.map((item) => <li key={item}>{item}</li>)}</ul>
              <code>{node.meta}</code>
            </div>
          </div>
          {index < nodes.length - 1 ? <div className={styles.flowArrow} aria-hidden>↓</div> : null}
        </div>
      ))}
    </div>
  );
}
