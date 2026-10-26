// preflight.mjs — prévol NON DESTRUCTIF du canari : aucune carte touchée, aucun port série ouvert, aucun téléversement. Chaque vérification est injectée (testable sans matériel).
// d : { nodeVersion, exec(cmd,args)->{code,stdout,stderr}, cli, git(args)->string, exists(path)->bool, ignored(path)->bool, runHostTests()->{ok,summary}, portFree(port)->bool, powershell()->bool, root, sketchDir, bridge }
export async function runPreflight(d) {
  const checks = []; const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: String(detail ?? "") });
  const major = Number(String(d.nodeVersion).replace(/^v/, "").split(".")[0]); add("node >= 18", major >= 18, d.nodeVersion);
  add("PowerShell disponible (pont série)", await d.powershell(), "System.IO.Ports.SerialPort");
  add("pont série présent", d.exists(d.bridge), d.bridge.split(/[\\/]/).pop());
  let cliOk = false, core = "?";
  try { const v = await d.exec(d.cli, ["version"]); cliOk = v.code === 0; core = v.stdout.split("\n")[0].trim(); } catch (e) { core = e.message; }
  add("arduino-cli exécutable", cliOk, core);
  let coreOk = false, coreV = "absent";
  try { const r = await d.exec(d.cli, ["core", "list", "--format", "json"]); const j = JSON.parse(r.stdout); const pl = (Array.isArray(j) ? j : j.platforms ?? []).find((p) => p.id === "arduino:renesas_uno"); coreV = pl?.installed_version ?? pl?.installed ?? "absent"; coreOk = coreV === "1.6.0"; } catch (e) { coreV = e.message; }
  add("cœur arduino:renesas_uno 1.6.0 installé", coreOk, coreV);
  add("secrets.h présent dans le sketch", d.exists(d.sketchDir + "/secrets.h"), "(contenu jamais lu ni journalisé)");
  add("secrets.h ignoré par git", d.ignored(d.sketchDir + "/secrets.h"), "git check-ignore");
  let commit = "?", dirty = true;
  try { commit = d.git(["rev-parse", "--short", "HEAD"]).trim(); const st = d.git(["status", "--porcelain", "--", "ota-lab/r4-ota3", "scripts", "consensus-pod"]).trim(); dirty = st.length > 0; add("fichiers du lot suivis par git sans modification locale", !dirty, dirty ? st.split("\n").slice(0, 5).join(" | ") : `commit ${commit}`); } catch (e) { add("git", false, e.message); }
  const ht = await d.runHostTests(); add("tests hôte du lot", ht.ok, ht.summary);
  if (d.serverPort != null) add("port TCP du serveur libre", await d.portFree(d.serverPort), String(d.serverPort)); else add("serveur externe (porteur) : port non contrôlé", true, "mode préparation / attache");
  return { ok: checks.every((c) => c.ok), checks, commit, dirty };
}
