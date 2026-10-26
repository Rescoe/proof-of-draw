import styles from "../learn.module.css";
import type { LearnPath } from "../../../lib/learnCatalog";

export type { LearnPath };

const groups = [
  {
    label: "Installation",
    links: [
      ["/learn?path=install#material", "Choisir l’écran"],
      ["/learn?path=install#wiring", "Câbler"],
      ["/learn?path=install#arduino-ide", "Préparer Arduino"],
      ["/learn?path=install#firmware", "Firmware et Wi-Fi"],
      ["/learn?path=install#configure", "Téléverser"],
      ["/learn?path=install#onboard", "Associer l’écran"],
      ["/learn?path=compat#compatibilite", "Compatibilité matérielle"],
      ["/learn?path=help#depannage", "Dépannage Wi-Fi et mises à jour"],
    ],
  },
  {
    label: "Autres parcours",
    links: [
      ["/learn?path=no-esp#no-esp", "Participer sans ESP"],
      ["/learn?path=network#how", "Vue d’ensemble"],
      ["/learn?path=network#roles", "Rôles du réseau"],
      ["/learn?path=network#consensus", "Consensus"],
      ["/learn?path=network#why", "Solidité technique"],
      ["/learn?path=network#licence", "Licences"],
      ["/learn?path=power#consommation", "Consommation électrique"],
      ["/learn?path=synthesis#synthese", "Synthèse technique"],
      ["/learn?path=synthesis#synth-niveaux", "Niveaux d’assurance"],
      ["/learn?path=roadmap#feuille-de-route", "Feuille de route"],
      ["/learn?path=compat#compatibilite", "Matrice de compatibilité"],
      ["/learn#recherche", "Rechercher un autre sujet"],
    ],
  },
];

function NavigationContent({ path }: { path: LearnPath }) {
  const visibleGroups = path === "install" ? [groups[0], groups[1]] : [groups[1], groups[0]];
  return (
    <>
      {visibleGroups.map((group) => (
        <div className={styles.navGroup} key={group.label}>
          <strong>{group.label}</strong>
          {group.links.map(([href, label]) => (
            <a href={href} key={href}>{label}</a>
          ))}
        </div>
      ))}
    </>
  );
}

export function LearnNavigation({ path }: { path: LearnPath }) {
  return (
    <>
      <aside className={styles.desktopNavigation} aria-label="Sommaire de la documentation">
        <div className={styles.navTitle}>Sur cette page</div>
        <NavigationContent path={path} />
      </aside>
      <details className={styles.mobileNavigation}>
        <summary>Sommaire de la page</summary>
        <div className={styles.mobileNavigationBody}><NavigationContent path={path} /></div>
      </details>
    </>
  );
}
