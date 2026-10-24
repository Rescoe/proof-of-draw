import { SectionHeading } from "./ContentPrimitives";
import { Block } from "./MarkdownDoc";
import { loadTroubleshooting } from "../../../lib/hardwareMatrix";
import styles from "../learn.module.css";

// Dépannage (24/10/2026) : rendu direct de docs/DEPANNAGE_INSTALLATION.md (source unique).

export function Troubleshooting() {
  const blocks = loadTroubleshooting();
  return (
    <section className={styles.majorSection} id="depannage">
      <div id="aide" className={styles.anchorOffset} />
      <SectionHeading eyebrow="Aide" title="Dépannage : Wi-Fi, première connexion, mises à jour">
        <p>Que faire, et à quel moment, quand la carte ne se connecte pas ou ne se met pas à jour.</p>
      </SectionHeading>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </section>
  );
}
