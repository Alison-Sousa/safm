import assert from 'node:assert/strict';
import { parseDelimitedLine, parseNumber, aggregateSeries, flattenIbgeResponse, deriveCvm, mergeSameDomain, broadcastNationalTime, auditRows, completeRows, parseComexTotals } from '../assets/connectors.js';
assert.deepEqual(parseDelimitedLine('a;"b;c";d'),['a','b;c','d']);
assert.equal(parseNumber('1.234,56'),1234.56);
const agg=aggregateSeries([{date:'2024-01-01',value:1},{date:'2024-02-01',value:2}], 'annual','compound');
assert.ok(Math.abs(agg[0].value-3.02)<1e-9);
const ibge=flattenIbgeResponse([{resultados:[{series:[{localidade:{id:'1',nome:'A'},serie:{'2020':'10','2021':'11'}}]}]}],'x');
assert.equal(ibge.length,2); assert.equal(ibge[1].x,11);
const rows=[
 {cd_cvm:'1',cnpj:'x',empresa:'A',ano:2023,_raw:{revenue:100,assets:200,net_income:20,equity:100,current_liabilities:40,noncurrent_liabilities:60,current_assets:80,ebit:30,cash:10},_meta:{}},
 {cd_cvm:'1',cnpj:'x',empresa:'A',ano:2024,_raw:{revenue:120,assets:220,net_income:22,equity:110,current_liabilities:44,noncurrent_liabilities:66,current_assets:88,ebit:36,cash:11},_meta:{}}
];
const d=deriveCvm(rows,['roe','revenue_growth','leverage','current_ratio']);
assert.equal(d.length,2); assert.equal(d[1].roe,20); assert.equal(d[1].crescimento_receita,20); assert.equal(d[1].endividamento,50); assert.equal(d[1].liquidez_corrente,2);
const merged=mergeSameDomain([[{period:'2024',ipca:4.5}],[{period:'2024',selic:10.5}]],'br-time');
assert.deepEqual(merged,[{period:'2024',ipca:4.5,selic:10.5}]);
const joined=broadcastNationalTime([{cd_cvm:'1',ano:2024,roe:20}],merged,'company-year');
assert.deepEqual(joined,[{cd_cvm:'1',ano:2024,roe:20,ipca:4.5,selic:10.5}]);
const audited=auditRows([{roe:10},{roe:null},{roe:20}],[{metric:'roe'}]);
assert.deepEqual(audited,{rawRows:3,completeRows:2,droppedRows:1,missingByMeasure:{roe:1}});
assert.equal(completeRows([{roe:10},{roe:null}],[{metric:'roe'}]).length,1);
const comex=parseComexTotals('"ARQUIVO";"CO_ANO";"VL_FOB"\n"EXP_2024.csv";"2024";337000000000','exportacoes_usd');
assert.deepEqual(comex,[{period:'2024',exportacoes_usd:337000000000}]);
console.log('connectors ok');
