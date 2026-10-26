import type { Metadata } from "next";
import Link from "next/link";
import { ExpertDocumentation } from "./components/ExpertDocumentation";
import { InstallGuide } from "./components/InstallGuide";
import { LearnHome } from "./components/LearnHome";
import { LearnFinder } from "./components/LearnFinder";
import { LearnNavigation } from "./components/LearnNavigation";
import { LegacyHashRedirect } from "./components/LegacyHashRedirect";
import { NoEspPath } from "./components/NoEspPath";
import { PowerPath } from "./components/PowerPath";
import { CompatibilityMatrix } from "./components/CompatibilityMatrix";
import { Roadmap } from "./components/Roadmap";
import { Troubleshooting } from "./components/Troubleshooting";
import { SynthesisPath } from "./components/SynthesisPath";
import { resolveInstallProfileId } from "./data/installProfiles";
import { buildCatalog } from "./catalogBuild";
import { PATH_LABEL, parsePath } from "../../lib/learnCatalog";
import styles from "./learn.module.css";

export const metadata: Metadata = {
  title: "Apprendre | Proof-of-Draw",
  description: "Installer un écran avec une carte ESP8266 ou UNO R4 WiFi, participer sans matériel, comprendre le réseau Proof-of-Draw, lire la synthèse technique et la feuille de route.",
};

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string | string[]; screen?: string | string[]; board?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const path = parsePath(params.path);
  const screenValue = Array.isArray(params.screen) ? params.screen[0] : params.screen;
  const boardValue = Array.isArray(params.board) ? params.board[0] : params.board;
  const initialProfileId = resolveInstallProfileId(screenValue ?? null, boardValue ?? null);
  const q = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";

  return (
    <main className={styles.page}>
      <LegacyHashRedirect hasPath={path !== null} />
      {path === null ? (
        <>
          <LearnHome />
          <LearnFinder entries={buildCatalog()} initialQuery={q.slice(0, 80)} />
        </>
      ) : (
        <>
          <nav className={styles.crumb} aria-label="Fil d’Ariane">
            <Link href="/learn">← Apprendre</Link><span aria-hidden>/</span><strong>{PATH_LABEL[path]}</strong>
            <Link href="/learn#recherche" className={styles.crumbSearch}>🔎 Rechercher un sujet</Link>
          </nav>
          <div className={styles.documentationLayout}>
            <LearnNavigation path={path} />
            <div className={styles.documentationContent}>
              {path === "install" ? <InstallGuide initialProfileId={initialProfileId} /> : null}
              {path === "no-esp" ? <NoEspPath /> : null}
              {path === "network" ? <ExpertDocumentation /> : null}
              {path === "power" ? <PowerPath /> : null}
              {path === "synthesis" ? <SynthesisPath /> : null}
              {path === "help" ? <Troubleshooting /> : null}
              {path === "roadmap" ? <Roadmap /> : null}
              {path === "compat" ? <CompatibilityMatrix /> : null}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
