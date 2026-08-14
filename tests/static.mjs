import fs from 'node:fs/promises'; import assert from 'node:assert/strict';
const files=['index.html','assets/app.js','assets/engine.js','assets/connectors.js','assets/exporters.js','assets/charts.js','assets/econometrics.js','assets/styles.css','data/ontology.json','data/bcb_annual.csv','data/cvm_finance.csv','data/comex_exports.csv','data/comex_imports.csv','404.html','netlify.toml','netlify/functions/proxy.mjs','tools/build_offline_snapshots.py'];
for(const f of files){await fs.access(new URL(`../${f}`,import.meta.url));}
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
for(const phrase of ['IA não ativa','hospedar bases gigantes','IA requer Netlify','robô não vai fingir']) assert.ok(!html.includes(phrase));
const ontology=JSON.parse(await fs.readFile(new URL('../data/ontology.json',import.meta.url),'utf8'));
const ids=ontology.measures.map(x=>x.id); assert.equal(new Set(ids).size,ids.length);
assert.ok(ontology.sources.length>=10); assert.ok(ontology.measures.length>=25);
assert.deepEqual(ontology.measures.filter(x=>x.build).map(x=>x.source).filter((x,i,a)=>a.indexOf(x)===i).sort(),['bcb','comex','cvm']);
assert.ok(html.includes('Modelagem econométrica')); assert.ok(html.includes('Todos os direitos reservados'));
console.log('static ok');
