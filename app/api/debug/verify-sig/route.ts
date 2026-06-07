// app/api/debug/verify-sig/route.ts
// Diagnostic : teste manuellement une signature ED25519 depuis les valeurs Serial du firmware.
// GET /api/debug/verify-sig?secret=<INTERNAL_API_SECRET>&privKey=<hex64>&pubKey=<hex64>&msg=<string>&sig=<hex128>

import { NextRequest, NextResponse } from "next/server";
import { verifyEd25519 } from "@/lib/ed25519";
import { createPublicKey } from "node:crypto";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const secret = url.searchParams.get("secret") ?? "";
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const pubKey = url.searchParams.get("pubKey") ?? "";
  const msg    = url.searchParams.get("msg")    ?? "";
  const sig    = url.searchParams.get("sig")    ?? "";

  if (!pubKey || !msg || !sig) {
    return NextResponse.json({
      error: "Paramètres requis: pubKey (64 hex), msg (string), sig (128 hex)",
      example: "/api/debug/verify-sig?secret=X&pubKey=abcd...&msg=dev_XXX:uuid:0.253&sig=abcd..."
    }, { status: 400 });
  }

  // Vérifications de base
  const checks: Record<string, unknown> = {
    pubKeyLength:   pubKey.length,
    pubKeyIsHex64:  /^[0-9a-f]{64}$/i.test(pubKey),
    sigLength:      sig.length,
    sigIsHex128:    /^[0-9a-f]{128}$/i.test(sig),
    message:        msg,
  };

  if (!checks.pubKeyIsHex64) return NextResponse.json({ error: "pubKey invalide (doit être 64 chars hex)", checks }, { status: 400 });
  if (!checks.sigIsHex128)   return NextResponse.json({ error: "sig invalide (doit être 128 chars hex)", checks }, { status: 400 });

  // Test via verifyEd25519 standard
  const valid = verifyEd25519(pubKey.toLowerCase(), msg, sig.toLowerCase());

  // Test SPKI import (pour debugger l'import de clé)
  let spkiOk = false;
  let spkiError = "";
  try {
    const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
    const pubKeyBytes = Buffer.from(pubKey, "hex");
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, pubKeyBytes]);
    createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    spkiOk = true;
  } catch (e) {
    spkiError = String(e);
  }

  return NextResponse.json({
    valid,
    spkiImportOk: spkiOk,
    spkiError: spkiError || null,
    checks,
    // Ce que le serveur reconstruit comme message pour la vérification de vote
    // (pour comparer avec MSG: du Serial)
    note: "Comparez 'message' avec la ligne MSG: du Serial ESP. Si identiques et valid=false → bug librairie.",
  });
}
