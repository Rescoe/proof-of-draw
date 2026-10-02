import Link from "next/link";
import { GalleryHorizontal, PencilLine, Users } from "lucide-react";
import { SectionHeading } from "./ContentPrimitives";
import styles from "../learn.module.css";

export function NoEspPath() {
  return (
    <section className={styles.majorSection} id="no-esp">
      <div id="sans-esp" className={styles.anchorOffset} />
      <SectionHeading eyebrow="Parcours 02" title="Participer sans ESP">
        <p>Vous n’avez pas de matériel ? Vous pouvez tout de même dessiner, être crédité et explorer le réseau.</p>
      </SectionHeading>

      <div className={styles.noEspGrid}>
        <article>
          <PencilLine size={22} aria-hidden />
          <h3>Dessiner sur un écran public</h3>
          <p>
            Certains participants placent leurs ESP en mode prêt public. Vous dessinez sur leurs écrans comme s’ils
            étaient les vôtres et votre nom d’artiste est inscrit dans le bloc miné.
          </p>
          <Link href="/profile">Voir les écrans disponibles <span aria-hidden>→</span></Link>
        </article>
        <article>
          <GalleryHorizontal size={22} aria-hidden />
          <h3>Explorer la chaîne</h3>
          <p>La galerie publique permet de consulter les blocs minés, les œuvres, les scores et les ESP validateurs.</p>
          <Link href="/gallery">Ouvrir le Block explorer <span aria-hidden>→</span></Link>
        </article>
        <article>
          <Users size={22} aria-hidden />
          <h3>Découvrir les artistes</h3>
          <p>Parcourez l’annuaire du réseau et retrouvez les artistes liés aux œuvres et aux appareils participants.</p>
          <Link href="/artists">Voir les artistes <span aria-hidden>→</span></Link>
        </article>
      </div>
    </section>
  );
}
