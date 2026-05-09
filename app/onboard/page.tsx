"use client";
// app/onboard/page.tsx
// Deux modes :
//   • URL avec ?code=XXXX-XXXX → pré-remplit le code (vient du QR de l'ESP)
//   • Fallback manuel : l'user entre son adresse MAC + artistName

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function OnboardForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Mode QR : ?code=ABCD-1234 pré-rempli
  const codeFromUrl = searchParams.get("code") ?? "";

  const [mode, setMode]           = useState<"qr" | "mac">(codeFromUrl ? "qr" : "qr");
  const [pairCode, setPairCode]   = useState(codeFromUrl.toUpperCase());
  const [mac, setMac]             = useState("");
  const [artistName, setArtist]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    if (codeFromUrl) setMode("qr");
  }, [codeFromUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!artistName.trim()) { setError("Le nom d'artiste est requis"); return; }
    if (mode === "qr" && !pairCode.trim()) { setError("Le code de jumelage est requis"); return; }
    if (mode === "mac" && !mac.trim()) { setError("L'adresse MAC est requise"); return; }

    setLoading(true);
    try {
      const payload =
        mode === "qr"
          ? { pairCode: pairCode.trim().toUpperCase(), artistName: artistName.trim() }
          : { mac: mac.trim().toLowerCase(), artistName: artistName.trim() };

      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Erreur lors du jumelage");
        return;
      }

      // Redirection vers le canvas de ce device
      router.push(data.canvasUrl);
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">

        <div>
          <h1 className="text-2xl font-bold">Connecter mon ESP</h1>
          <p className="text-gray-400 text-sm mt-1">
            Scanne le QR code affiché sur ton écran, ou entre les infos manuellement.
          </p>
        </div>

        {/* Toggle mode */}
        <div className="flex rounded overflow-hidden border border-gray-700 text-sm">
          <button
            type="button"
            onClick={() => setMode("qr")}
            className={`flex-1 py-2 transition ${
              mode === "qr" ? "bg-white text-black font-semibold" : "bg-transparent text-gray-400"
            }`}
          >
            📱 Code QR
          </button>
          <button
            type="button"
            onClick={() => setMode("mac")}
            className={`flex-1 py-2 transition ${
              mode === "mac" ? "bg-white text-black font-semibold" : "bg-transparent text-gray-400"
            }`}
          >
            🔧 Adresse MAC
          </button>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-700 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {mode === "qr" ? (
          <div>
            <label className="block text-sm font-medium mb-1">
              Code affiché sur l&apos;écran <span className="text-red-400">*</span>
            </label>

          <input
            type="text"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.replace(/-/g, '').toUpperCase())}
            placeholder="ABCDEFGH"
            maxLength={8} // ✅ 8 max sans tirets
            autoFocus={!codeFromUrl}
              className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-3
                         font-mono text-xl tracking-widest text-center focus:border-white outline-none"
            />
            <p className="text-gray-500 text-xs mt-1">
              Si le QR ne fonctionne pas, bascule sur &quot;Adresse MAC&quot;
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">
              Adresse MAC de l&apos;ESP <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              placeholder="84:0d:8e:b4:cb:65"
              autoFocus
              className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-3
                         font-mono text-sm focus:border-white outline-none"
            />
            <p className="text-gray-500 text-xs mt-1">
              Affichée dans le Serial Monitor Arduino après boot
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            Ton nom d&apos;artiste <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={artistName}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="ex: Rescoe"
            maxLength={64}
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-3
                       focus:border-white outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-white text-black py-3 rounded font-semibold
                     hover:bg-gray-200 transition disabled:opacity-50"
        >
          {loading ? "Connexion…" : "Connecter et dessiner →"}
        </button>

      </form>
    </div>
  );
}

export default function OnboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <OnboardForm />
    </Suspense>
  );
}