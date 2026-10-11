import re,glob,os,json
M="docs/mesures/8B2B3_FIX1_2026_10_12"
rows={}
for f in sorted(glob.glob(M+"/pile-*.txt")):
    tag=os.path.basename(f)[5:-4]
    t=open(f).read()
    log=open(f"/tmp/claude-0/out/{tag}/compile.log").read()
    flash=int(re.search(r"Sketch uses (\d+) bytes",log).group(1)); ram=int(re.search(r"Global variables use (\d+) bytes",log).group(1))
    warn=len(set(re.findall(r"(body\.h:\d+:\d+: warning: [^\n]*)",log)))
    def chain(lbl,frm):
        m=re.search(r"^"+re.escape(lbl)+r"\s+depuis "+frm+r"\s+(\d+) o\s+marge\s+(-?\d+) o",t,re.M); return int(m.group(2)) if m else None
    d=dict(flash=flash,ram=ram,warn=warn,
      reg_setup=chain("register (hors affichage d'appairage)","setup"), reg_loop=chain("register (hors affichage d'appairage)","loop"),
      pull_setup=chain("pull + pull-frame + affichage + ACK (toutes branches)","setup"), pull_loop=chain("pull + pull-frame + affichage + ACK (toutes branches)","loop"),
      vote_loop=chain("validate / vote (hors affichage d'appairage)","loop"))
    nets=re.findall(r"^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$",t,re.M)
    d["net"]=min(int(n[5]) for n in nets) if nets else None
    m=re.search(r"→ SUFFISANTE \(réserve (\d+) o\)",t); d["wifi"]=int(m.group(1)) if m else None
    wk=re.findall(r"marge au pire cas : (\d+) o",t); d["work"]=[int(x) for x in wk]
    m=re.findall(r"loop > doValidatev > _ZN5PodEd4sign.*marge (\d+) o",t); d["ed_vote"]=int(m[0]) if m else None
    rows[tag]=d
json.dump(rows,open("/tmp/claude-0/summary.json","w"),indent=1)
for k,v in rows.items(): print(k,v)
