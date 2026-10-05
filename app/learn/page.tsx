import type { Metadata } from "next";
import { ExpertDocumentation } from "./components/ExpertDocumentation";
import { InstallGuide } from "./components/InstallGuide";
import { LearnHome } from "./components/LearnHome";
import { LearnNavigation } from "./components/LearnNavigation";
import type { LearnPath } from "./components/LearnNavigation";
import { LegacyHashRedirect } from "./components/LegacyHashRedirect";
import { NoEspPath } from "./components/NoEspPath";
import { PowerPath } from "./components/PowerPath";
import { isInstallProfileId } from "./data/installProfiles";
import styles from "./learn.module.css";

export const metadata: Metadata = {
  title: "Apprendre | Proof-of-Draw",
  description: "Installer un écran ESP8266, participer sans matériel et comprendre le réseau Proof-of-Draw.",
};

function parsePath(value: string | string[] | undefined): LearnPath | null {
  const path = Array.isArray(value) ? value[0] : value;
  return path === "install" || path === "no-esp" || path === "network" || path === "power" ? path : null;
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string | string[]; screen?: string | string[] }>;
}) {
  const params = await searchParams;
  const path = parsePath(params.path);
  const screenValue = Array.isArray(params.screen) ? params.screen[0] : params.screen;
  const initialProfileId = screenValue && isInstallProfileId(screenValue) ? screenValue : "eink29bwr";

  return (
    <main className={styles.page}>
      <LegacyHashRedirect hasPath={path !== null} />
      <LearnHome />
      {path ? (
        <div className={styles.documentationLayout}>
          <LearnNavigation path={path} />
          <div className={styles.documentationContent}>
            {path === "install" ? <InstallGuide initialProfileId={initialProfileId} /> : null}
            {path === "no-esp" ? <NoEspPath /> : null}
            {path === "network" ? <ExpertDocumentation /> : null}
            {path === "power" ? <PowerPath /> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
