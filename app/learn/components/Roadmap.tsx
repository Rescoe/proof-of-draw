import { Callout, SectionHeading } from "./ContentPrimitives";
import { phaseProgress, roadmapProgress, ROADMAP, STATUS_LABEL, type RoadmapStatus } from "../data/roadmap";
import styles from "../learn.module.css";

const STATUS_CLASS: Record<RoadmapStatus, string> = { done: styles.statusDone, doing: styles.statusDoing, todo: styles.statusTodo };

function Bar({ done, doing, total, label }: { done: number; doing: number; total: number; label: string }) {
  const d = total ? (done / total) * 100 : 0;
  const g = total ? (doing / total) * 100 : 0;
  return (
    <div className={styles.roadBar} role="img" aria-label={label}>
      <span className={styles.roadBarDone} style={{ width: `${d}%` }} />
      <span className={styles.roadBarDoing} style={{ width: `${g}%` }} />
    </div>
  );
}

/** Feuille de route : tout en bas de la page Apprendre, quel que soit le parcours choisi. */
export function Roadmap() {
  const all = roadmapProgress();
  return (
    <section className={`${styles.majorSection} ${styles.roadmapSection}`} id="feuille-de-route" aria-labelledby="roadmap-title">
      <SectionHeading eyebrow="Feuille de route" title="Ce qui est fait, ce qui reste">
        <p id="roadmap-title">
          Vue d’ensemble du travail accompli et du travail restant, jusqu’à un réseau de nœuds qui réplique et vérifie la chaîne.
          Un point n’est marqué « Fait » que s’il est livré <em>et</em> vérifié ; les essais sur carte sont précisés.
        </p>
      </SectionHeading>

      <div className={styles.roadTotal}>
        <div className={styles.roadTotalNumbers}>
          <strong>{all.done}</strong><span>/ {all.total} points faits</span>
          <small>{all.doing} en cours · {all.todo} à faire</small>
        </div>
        <Bar done={all.done} doing={all.doing} total={all.total} label={`${all.done} faits, ${all.doing} en cours, ${all.todo} à faire sur ${all.total}`} />
      </div>

      <div className={styles.roadLegend} aria-label="Légende">
        {(["done", "doing", "todo"] as const).map((s) => (
          <span key={s} className={`${styles.statusBadge} ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>
        ))}
      </div>

      <div className={styles.roadPhases}>
        {ROADMAP.map((phase) => {
          const p = phaseProgress(phase);
          return (
            <details className={styles.roadPhase} key={phase.id} open={p.done < p.total}>
              <summary>
                <span className={styles.roadPhaseTitle}>{phase.title}</span>
                <span className={styles.roadPhaseCount}>{p.done}/{p.total}</span>
                <Bar done={p.done} doing={p.doing} total={p.total} label={`${phase.title} : ${p.done} sur ${p.total} faits`} />
              </summary>
              <p className={styles.roadPhaseSummary}>{phase.summary}</p>
              <ul className={styles.roadItems}>
                {phase.items.map((item) => (
                  <li key={item.id}>
                    <span className={`${styles.statusBadge} ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                    <div>
                      <strong>{item.title}</strong>
                      {item.note ? <small>{item.note}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>

      <Callout tone="info" title="Ordre prévu">
        <p>
          D’abord rendre un bloc vérifiable hors du serveur (phase 4), pendant que le noyau de consensus est extrait (phase 5) ; puis un seul
          reflash groupé avec les mises à jour à distance (phase 6) ; enfin les nœuds Raspberry Pi et PoDScan (phase 7). Les animations
          validées par calcul (phase 2) suivent le même noyau.
        </p>
      </Callout>
    </section>
  );
}
