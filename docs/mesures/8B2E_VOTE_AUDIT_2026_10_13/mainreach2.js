const path=require("path"),fs=require("fs");
const {parse}=require(path.join(process.argv[2],"scripts","stack-callgraph.js"));
const f=parse(fs.readFileSync(process.argv[3],"utf8"));
const BAR=/onSdDirect|runSized|podNetRun|podWifiRun|podWorkRun|PodEd|PodNet|netHttpRaw|logfEmit|podedimpl|podNetCallOnStack/;
const seen=new Set(),parent=new Map(),q=["hal_entry"];
while(q.length){const n=q.shift();if(seen.has(n))continue;seen.add(n);const x=f.get(n);if(!x)continue;for(const c of [...x.calls,...x.tails]){if(BAR.test(c))continue;if(!parent.has(c))parent.set(c,n);q.push(c);}}
const pats=process.argv.slice(4);
for(const p of pats){const re=new RegExp(p);console.log("## "+p);for(const n of seen){if(re.test(n)){const chain=[];let c=n;while(c&&chain.length<6){chain.push(c.replace(/^_ZL\d*/,"").slice(0,34));c=parent.get(c);}console.log("   "+chain.reverse().join(" > "));}}}
