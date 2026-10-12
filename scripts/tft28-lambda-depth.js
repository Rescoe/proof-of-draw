/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/tft28-lambda-depth.js — LOT8B2E : profondeur STATIQUE (appels directs) sous un symbole donné, p. ex. une lambda confiée à une pile dédiée. node scripts/tft28-lambda-depth.js f.dis <symbole> …
// profondeur statique sous une racine (sans barrière sur la racine), appels directs seulement
const fs=require("fs");const {parse}=require("./stack-callgraph");
const f=parse(fs.readFileSync(process.argv[2],"utf8"));const names=[...f.keys()];
const BAR=/onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet/;
const skip=new Set(["_printf_float","__cvt","_dtoa_r",...names.filter(k=>/logfEmit/.test(k))]);
function deep(n,vis=new Set(),memo=new Map(),root=false){if(memo.has(n))return memo.get(n);const x=f.get(n);if(!x||skip.has(n))return{d:0,p:[n+"?"]};
if(!root&&BAR.test(n))return{d:x.frame,p:[n+"("+x.frame+" barriere)"]};if(vis.has(n))return{d:0,p:[]};vis.add(n);let b={d:0,p:[]};for(const c of [...x.calls,...x.tails]){const r=deep(c,vis,memo);if(r.d>b.d)b=r}vis.delete(n);const r={d:x.frame+b.d,p:[n.slice(0,60)+"("+x.frame+")",...b.p]};memo.set(n,r);return r}
for(const a of process.argv.slice(3)){const n=names.find(k=>k===a||k.includes(a));if(!n){console.log(a,"absente");continue}const r=deep(n,new Set(),new Map(),true);console.log(n,"cadre",f.get(n).frame,"chaine",r.d,"\n   ",r.p.join("\n    > "))}
