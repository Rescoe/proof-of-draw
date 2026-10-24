import type { ReactNode } from "react";
import { Callout, SectionHeading } from "./ContentPrimitives";
import { loadHardwareMatrix, parseInline, type MatrixBlock } from "../../../lib/hardwareMatrix";
import styles from "../learn.module.css";

// Compatibilité matérielle (24/10/2026) : la page est le RENDU DIRECT de docs/MATRICE_COMPATIBILITE_MATERIELLE.md, lu à la construction — aucune copie à tenir à jour.
// Pour modifier ce qu'elle dit, on modifie le fichier de la matrice (même commit que le test matériel qui justifie le changement).

function Inline({ text }: { text: string }): ReactNode {
  return <>{parseInline(text).map((p, i) => p.kind === "strong" ? <strong key={i}>{p.text}</strong> : p.kind === "code" ? <code key={i} className={styles.inlineCode}>{p.text}</code> : <span key={i}>{p.text}</span>)}</>;
}

function Block({ block }: { block: MatrixBlock }) {
  switch (block.kind) {
    case "h": return block.level === 1 ? null : block.level === 2 ? <h3 className={styles.matrixH}>{block.text}</h3> : <h4 className={styles.matrixH}>{block.text}</h4>;
    case "p": return <p><Inline text={block.text} /></p>;
    case "quote": return <Callout tone="info" title="À savoir">{block.lines.map((l, i) => <p key={i}><Inline text={l} /></p>)}</Callout>;
    case "ul": return <ul>{block.items.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ul>;
    case "ol": return <ol>{block.items.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ol>;
    case "code": return <pre className={styles.codeBlock}>{block.text}</pre>;
    case "table": return (
      <div className={styles.synthTableWrap}>
        <table className={styles.synthTable}>
          <thead><tr>{block.head.map((h, i) => <th key={i}><Inline text={h} /></th>)}</tr></thead>
          <tbody>{block.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}><Inline text={c} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
}

export function CompatibilityMatrix() {
  const blocks = loadHardwareMatrix();
  return (
    <section className={styles.majorSection} id="compatibilite">
      <div id="matrice" className={styles.anchorOffset} />
      <SectionHeading eyebrow="Référence" title="Compatibilité matérielle et niveaux de preuve">
        <p>
          Ce que chaque combinaison carte, écran et capteur a réellement démontré. Cette page est le rendu direct du fichier
          <code className={styles.inlineCode}> docs/MATRICE_COMPATIBILITE_MATERIELLE.md</code> du dépôt : elle ne peut pas dire autre chose que la documentation.
        </p>
      </SectionHeading>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </section>
  );
}
