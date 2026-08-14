import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { analyzeQuery, commonConfig, getMeasure } from '../assets/engine.js';
const ontology=JSON.parse(await fs.readFile(new URL('../data/ontology.json',import.meta.url),'utf8'));

let r=analyzeQuery('finanças afeta crescimento das empresas',ontology);
assert.deepEqual(r.dimensions.map(d=>d.id),['corporateFinance','firmGrowth']);

r=analyzeQuery('Selic desde 1995',ontology);
assert.equal(r.years.start,1995); assert.equal(r.years.end,new Date().getFullYear());

r=analyzeQuery('exportacoes importacoes e saldo comercial desde 1997',ontology);
assert.deepEqual(r.dimensions.map(d=>d.id),['foreignTrade']);
assert.ok(r.directMeasures.some(item=>item.id==='comex_balance'));

r=analyzeQuery('finacas afeta cresicmetne emprsas',ontology);
assert.ok(r.dimensions.some(d=>d.id==='corporateFinance'),'deve entender finanças com erros');
assert.ok(r.dimensions.some(d=>d.id==='firmGrowth'),'deve entender crescimento com erros');

r=analyzeQuery('gasto publico afeta mrotalidade feminina das mulheres nos municipios',ontology);
assert.ok(!r.dimensions.some(d=>d.id==='health'),'tema sem conector não deve aparecer como montável');
assert.equal(r.directMeasures.length,0);

r=analyzeQuery('mortalidade infantil nos municipios',ontology);
assert.equal(r.directMeasures.length,0);

r=analyzeQuery('futebol financas dos clubes',ontology);
assert.equal(r.dimensions.length,0,'tema sem conector não pode abrir um fluxo vazio');
assert.ok(!r.directMeasures.some(x=>x.id==='sports_club_finance'));
assert.ok(!r.dimensions.some(d=>d.id==='labor'),'futebol nunca deve virar mercado de trabalho');

r=analyzeQuery('astronomia e telescopios',ontology);
assert.equal(r.dimensions.length,0,'assunto desconhecido nao deve ser inventado');

r=analyzeQuery('financas',ontology);
assert.equal(r.dimensions.length,0,'financas sem contexto deve pedir recorte');
assert.ok(r.suggestedDimensions.some(d=>d.id==='corporateFinance'));

const measures=['cvm_roe','cvm_revenue_growth'].map(id=>getMeasure(ontology,id));
const cfg=commonConfig(measures,analyzeQuery('2012 a 2024',ontology));
assert.equal(cfg.domain,'company-year');
assert.ok(cfg.frequencies.includes('annual'));
assert.equal(cfg.start,2011);

const mixed=[getMeasure(ontology,'cvm_roe'),getMeasure(ontology,'bcb_ipca')];
const mixedCfg=commonConfig(mixed,analyzeQuery('roe e inflacao anual',ontology));
assert.equal(mixedCfg.domain,'company-year');
assert.equal(mixedCfg.mixedDomain,false);
assert.equal(mixedCfg.joinMode,'broadcast-time');
assert.deepEqual(mixedCfg.frequencies,['annual']);
console.log('engine ok');
