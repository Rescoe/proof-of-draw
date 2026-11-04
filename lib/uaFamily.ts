// lib/uaFamily.ts
// Famille de navigateur réduite à ce qui sert à diagnostiquer une perte de session (aucun identifiant, aucune empreinte) : « iOS 12 · Safari », « iOS 17 · Instagram »,
// « Android · Chrome »… Module PUR (testé). Sert à la télémétrie `stat:sesslost` (04/11/2026) : savoir si la perte du cookie touche surtout un système / une application.

export function uaFamily(ua: string | null | undefined): string {
  const s = (ua ?? "").slice(0, 400);
  if (!s) return "inconnu";
  const inApp = /Snapchat|Instagram|FBAN|FBAV|FB_IAB|MicroMessenger|TikTok|musical_ly|LinkedInApp|Line\/|GSA\/|Telegram|WhatsApp/i.exec(s);
  let os = "autre";
  const ios = /(?:iPhone|iPad|iPod)[^)]*OS (\d+)[_.]/.exec(s) ?? /CPU OS (\d+)[_.]/.exec(s);
  if (ios) os = `iOS ${ios[1]}`;
  else if (/Android (\d+)/.test(s)) os = `Android ${/Android (\d+)/.exec(s)![1]}`;
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Mac OS X/.test(s)) os = "macOS";
  else if (/Linux/.test(s)) os = "Linux";
  let browser = "navigateur";
  if (inApp) browser = inApp[0].replace("FBAN", "Facebook").replace("FBAV", "Facebook").replace("FB_IAB", "Facebook").replace("musical_ly", "TikTok").replace("GSA/", "Google");
  else if (/CriOS|Chrome\//.test(s)) browser = "Chrome";
  else if (/FxiOS|Firefox\//.test(s)) browser = "Firefox";
  else if (/EdgiOS|Edg\//.test(s)) browser = "Edge";
  else if (/Safari\//.test(s)) browser = "Safari";
  else if (/Mobile\//.test(s)) browser = "vue web (WebView)";
  return `${os} · ${browser}`;
}
