import Link from "next/link";
import { Cable, Network, PencilLine } from "lucide-react";
import { Eyebrow } from "./ContentPrimitives";
import styles from "../learn.module.css";

const paths = [
  {
    href: "/learn?path=install#installer",
    icon: Cable,
    number: "01",
    title: "Installer un écran",
    description: "Choisissez votre matériel puis suivez uniquement le câblage, les bibliothèques et le firmware qui lui correspondent.",
    action: "Commencer l’installation",
  },
  {
    href: "/learn?path=no-esp#sans-esp",
    icon: PencilLine,
    number: "02",
    title: "Participer sans ESP",
    description: "Dessinez sur un écran partagé, consultez les œuvres et découvrez les artistes sans posséder de matériel.",
    action: "Voir les possibilités",
  },
  {
    href: "/learn?path=network#reseau",
    icon: Network,
    number: "03",
    title: "Comprendre le réseau",
    description: "Explorez l’architecture pull, les rôles, le consensus, la chaîne de blocs et les choix techniques.",
    action: "Lire la documentation",
  },
];

export function LearnHome() {
  return (
    <section className={styles.hero} id="intro">
      <div className={styles.heroCopy}>
        <Eyebrow>Documentation · Tutoriels · Référence</Eyebrow>
        <h1>
          Apprendre <span>Proof-of-Draw</span>
        </h1>
        <p>
          Trouvez directement le parcours qui correspond à votre objectif : installer un écran,
          participer sans matériel ou comprendre le fonctionnement du réseau.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} href="/learn?path=install#installer">Installer mon écran</Link>
          <Link className={styles.secondaryButton} href="/draw">Dessiner maintenant</Link>
        </div>
      </div>

      <div className={styles.pathGrid} aria-label="Choisir un parcours">
        {paths.map((path) => {
          const Icon = path.icon;
          return (
            <Link href={path.href} className={styles.pathCard} key={path.href}>
              <div className={styles.pathCardTop}>
                <span className={styles.pathIcon}><Icon size={21} aria-hidden /></span>
                <span className={styles.pathNumber}>{path.number}</span>
              </div>
              <h2>{path.title}</h2>
              <p>{path.description}</p>
              <span className={styles.pathAction}>{path.action} <span aria-hidden>→</span></span>
            </Link>
          );
        })}
      </div>

      <div className={styles.projectOverview}>
        <div>
          <Eyebrow>Le projet en une minute</Eyebrow>
          <h2>Qu’est-ce que Proof-of-Draw ?</h2>
          <p>
            Proof-of-Draw est un réseau ouvert où des artistes dessinent à la main dans un navigateur web.
            Leurs créations sont validées collectivement par des micro-ordinateurs ESP8266, affichées sur des
            écrans physiques puis conservées dans une chaîne de blocs légère.
          </p>
        </div>
        <div className={styles.overviewSteps}>
          {[
            ["01", "Dessiner", "Créer depuis un navigateur, sans installation."],
            ["02", "Valider", "Les ESP connectés votent collectivement."],
            ["03", "Miner", "Le dessin, l’auteur et la date rejoignent un bloc."],
            ["04", "Afficher", "L’œuvre arrive sur les écrans physiques compatibles."],
          ].map(([number, title, description]) => (
            <div key={title}><span>{number}</span><p><strong>{title}</strong><small>{description}</small></p></div>
          ))}
        </div>
      </div>
    </section>
  );
}
