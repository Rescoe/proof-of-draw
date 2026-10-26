// app/measures-lab/page.tsx — bac à sable de l'explorateur de mesures (DÉVELOPPEMENT UNIQUEMENT). Données synthétiques, aucun accès Redis. En production : 404.
import { notFound } from "next/navigation";
import LabClient from "./LabClient";

export const dynamic = "force-dynamic";

export default function MeasuresLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabClient />;
}
