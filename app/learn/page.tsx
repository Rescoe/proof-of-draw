import type { Metadata } from "next";
import { ExpertDocumentation } from "./components/ExpertDocumentation";
import { InstallGuide } from "./components/InstallGuide";
import { LearnHome } from "./components/LearnHome";
import { LearnNavigation } from "./components/LearnNavigation";
import type { LearnPath } from "./components/LearnNavigation";
import { LegacyHashRedirect } from "./components/LegacyHashRedirect";
import { NoEspPath } from "./components/NoEspPath";
import { PowerPath } from "./components/PowerPath";
import { Roadmap } from "./components/Roadmap";
import { SynthesisPath } from "./components/SynthesisPath";
import { resolveInstallProfileId } from "./data/installProfiles";
import styles from "./learn.module.css";

export const metadata: Metadata = {
  title: "Apprendre | Proof-of-Draw",
  description: "Installer un écran avec une carte ESP8266 ou UNO R4 WiFi, participer sans matériel, comprendre le réseau Proof-of-Draw, lire la synthèse technique et la feuille de route.",
};

function parsePath(value: string | string[] | undefined): LearnPath | null {
  const path = Array.isArray(value) ? value[0] : value;
  return path === "install" || path === "no-esp" || path === "network" || path === "power" || path === "synthesis" ? path : null;
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string | string[]; screen?: string | string[]; board?: string | string[] }>;
}) {
  const params = await searchParams;
  const path = parsePath(params.path);
  const screenValue = Array.isArray(params.screen) ? params.screen[0] : params.screen;
  const boardValue = Array.isArray(params.board) ? params.board[0] : params.board;
  const initialProfileId = resolveInstallProfileId(screenValue ?? null, boardValue ?? null);

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
            {path === "synthesis" ? <SynthesisPath /> : null}
          </div>
        </div>
      ) : null}
      <div className={styles.roadmapWrap}>
        <Roadmap />
      </div>
    </main>
  );
}
