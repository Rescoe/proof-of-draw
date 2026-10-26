import { SectionHeading } from "./ContentPrimitives";
import { Block } from "./MarkdownDoc";
import { loadHardwareMatrix } from "../../../lib/hardwareMatrix";
import { headingIds } from "../../../lib/learnCatalog";
import styles from "../learn.module.css";

// Compatibilité matérielle (24/10/2026) : la page est le RENDU DIRECT de docs/MATRICE_COMPATIBILITE_MATERIELLE.md, lu à la construction — aucune copie à tenir à jour.
// Pour modifier ce qu'elle dit, on modifie le fichier de la matrice (même commit que le test matériel qui justifie le changement).

export function CompatibilityMatrix() {
  const blocks = loadHardwareMatrix();
  const ids = headingIds(blocks, "c-");
  return (
    <section className={styles.majorSection} id="compatibilite">
      <div id="matrice" className={styles.anchorOffset} />
      <SectionHeading eyebrow="Référence" title="Compatibilité matérielle et niveaux de preuve">
        <p>
          Ce que chaque combinaison carte, écran et capteur a réellement démontré. Cette page est le rendu direct du fichier
          <code className={styles.inlineCode}> docs/MATRICE_COMPATIBILITE_MATERIELLE.md</code> du dépôt : elle ne peut pas dire autre chose que la documentation.
        </p>
      </SectionHeading>
      {blocks.map((b, i) => <Block key={i} block={b} id={ids[i]} />)}
    </section>
  );
}
