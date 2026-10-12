/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/tft28-register-paths.js — LOT8B2D REGISTER-STACK-FIX2 : profondeur STATIQUE de la pile principale (appels directs ; ni appels indirects, ni interruptions) pour des fonctions nommées.
//   arm-none-eabi-objdump -d --no-show-raw-insn <elf> > f.dis ; node scripts/tft28-register-paths.js f.dis '^_ZL16registerExchange' '^_ZL21registerShowConnected' …
// Chaque argument est une expression régulière sur le nom manglé ; les enveloppes de piles dédiées (onSdDirect, runSized, podNetRun, podWifiRun, podWorkRun, PodEd, PodNet) sont des BARRIÈRES.
// Base = hal_entry 8 + arduino_main 16 + setup 224 (valeurs du canari 1.6.0 ; à relire dans scripts/tft28-stack-report.js si elles changent).
const fs=require("fs");const {parse}=require("./stack-callgraph");
const f=parse(fs.readFileSync(process.argv[2],"utf8"));const names=[...f.keys()];
const BAR=/onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet/;
const skip=new Set(["_printf_float","__cvt","_dtoa_r",...names.filter(k=>/logfEmit/.test(k))]);
function deep(n,vis=new Set(),memo=new Map()){if(memo.has(n))return memo.get(n);const x=f.get(n);if(!x||skip.has(n))return{d:0,p:[n+"?"]};
if(BAR.test(n))return{d:x.frame,p:[n+"("+x.frame+" barriere)"]};if(vis.has(n))return{d:0,p:[]};vis.add(n);let b={d:0,p:[]};for(const c of [...x.calls,...x.tails]){const r=deep(c,vis,memo);if(r.d>b.d)b=r}vis.delete(n);const r={d:x.frame+b.d,p:[n.slice(0,40)+"("+x.frame+")",...b.p]};memo.set(n,r);return r}
const base=8+16+224;
for(const a of process.argv.slice(3)){const n=names.find(k=>new RegExp(a).test(k));if(!n){console.log(a,"absente");continue}const r=deep(n);console.log(a,"cadre",f.get(n).frame,"chaine",r.d,"cumul(setup)",base+r.d,"marge",1024-base-r.d,"\n   ",r.p.join(" > "))}
