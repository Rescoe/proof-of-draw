import Link from "next/link";
import { Cable, ClipboardCheck, LifeBuoy, Network, PencilLine } from "lucide-react";
import { Eyebrow } from "./ContentPrimitives";
import styles from "../learn.module.css";

// Cinq intentions : chacune mène à UNE destination dédiée ; la recherche (juste dessous) couvre tout le reste.
const intents = [
  { href: "/learn?path=install#installer", icon: Cable, title: "Je veux installer un écran", description: "Choisir le matériel, câbler, téléverser le firmware, associer l’écran.", action: "Commencer l’installation" },
  { href: "/learn?path=no-esp#no-esp", icon: PencilLine, title: "Je veux dessiner sans matériel", description: "Dessiner sur un écran partagé, voir les œuvres et les artistes.", action: "Voir comment participer" },
  { href: "/learn?path=help#depannage", icon: LifeBuoy, title: "Je cherche une solution à un problème", description: "Wi-Fi, première connexion, mises à jour, écran qui ne répond pas.", action: "Ouvrir le dépannage" },
  { href: "/learn?path=network#reseau", icon: Network, title: "Je veux comprendre le réseau", description: "Pull, rôles, consensus, chaîne de blocs, choix techniques.", action: "Lire la documentation" },
  { href: "/learn?path=compat#compatibilite", icon: ClipboardCheck, title: "Je consulte la compatibilité et l’état du projet", description: "Ce qui est prouvé sur carte, la feuille de route, la synthèse technique.", action: "Voir la compatibilité" },
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
          Dis ce que tu veux faire : chaque porte mène directement au bon contenu. Pour tout le reste, la recherche et les filtres
          (niveau et type) retrouvent un sujet en quelques secondes.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} href="/learn#recherche">Rechercher un sujet</Link>
          <Link className={styles.secondaryButton} href="/draw">Dessiner maintenant</Link>
          <Link className={styles.secondaryButton} href="/learn?path=roadmap#feuille-de-route">Feuille de route</Link>
          <Link className={styles.secondaryButton} href="/learn?path=compat#compatibilite">Matrice de compatibilité</Link>
          <Link className={styles.secondaryButton} href="/learn?path=synthesis#synthese">Synthèse technique</Link>
          <Link className={styles.secondaryButton} href="/learn?path=power#consommation">Consommation électrique</Link>
        </div>
      </div>

      <div className={styles.intentGrid} aria-label="Que veux-tu faire ?">
        {intents.map((intent) => {
          const Icon = intent.icon;
          return (
            <Link href={intent.href} className={styles.intentCard} key={intent.href}>
              <span className={styles.pathIcon}><Icon size={21} aria-hidden /></span>
              <strong>{intent.title}</strong>
              <span>{intent.description}</span>
              <em>{intent.action} →</em>
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
            Leurs créations sont validées collectivement par des microcontrôleurs connectés, affichées sur des
            écrans physiques puis conservées dans une chaîne de blocs légère.
          </p>
        </div>
        <div className={styles.overviewSteps}>
          {[
            ["01", "Dessiner", "Créer depuis un navigateur, sans installation."],
            ["02", "Valider", "Les appareils connectés votent collectivement."],
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
