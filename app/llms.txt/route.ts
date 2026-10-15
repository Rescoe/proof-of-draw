import { buildLlmsTxt } from "@/lib/llmsTxt";

// /llms.txt : texte factuel construit depuis lib/projectStatus.ts. Statique (aucune requête, aucun Redis) ; convention de lisibilité, pas un standard obligatoire.
export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
