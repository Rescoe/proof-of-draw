import styles from "../learn.module.css";

export type LearnPath = "install" | "no-esp" | "network" | "power";

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
