import { analyzeQuery, commonConfig, getMeasure } from '../assets/engine.js';
import { aggregateSeries, mergeSameDomain, broadcastNationalTime, parseComexTotals, parseSnapshotTable, parseNumber, metricColumn, buildDataset } from '../assets/connectors.js';
import { numericColumns, summarizeTrend } from '../assets/charts.js';
import { fitOLS, fitFixedEffects, fitDID, fitDDD, generateModelScript } from '../assets/econometrics.js';

const result=document.querySelector('#result');
const assert=(condition,message)=>{if(!condition) throw new Error(message);};

try{
  const ontology=await fetch('../data/ontology.json').then(response=>response.json());
  let intent=analyzeQuery('futebol financas dos clubes',ontology);
  assert(intent.dimensions.length===0,'tema sem conector não deve abrir fluxo vazio');
  assert(!intent.dimensions.some(d=>d.id==='labor'),'futebol nao pode virar trabalho');
  intent=analyzeQuery('finacas afeta cresicmetne emprsas',ontology);
  assert(intent.dimensions.some(d=>d.id==='corporateFinance'),'deve tolerar erro em financas');
  assert(intent.dimensions.some(d=>d.id==='firmGrowth'),'deve tolerar erro em crescimento');
  assert(analyzeQuery('astronomia telescopios',ontology).dimensions.length===0,'nao deve inventar tema');
  const since=analyzeQuery('Selic desde 1995',ontology);assert(since.years.start===1995&&since.years.end===new Date().getFullYear(),'desde deve ir até o período atual');
  const trade=analyzeQuery('exportacoes importacoes e saldo comercial desde 1997',ontology);assert(trade.dimensions[0]?.id==='foreignTrade','comércio exterior ausente');
  const cfg=commonConfig([getMeasure(ontology,'cvm_roe'),getMeasure(ontology,'bcb_ipca')],intent);
  assert(cfg.joinMode==='broadcast-time'&&cfg.domain==='company-year','deve planejar juncao temporal');
  const annual=aggregateSeries([{date:'2024-01-01',value:1},{date:'2024-02-01',value:2}],'annual','compound');
  assert(Math.abs(annual[0].value-3.02)<1e-9,'agregacao anual incorreta');
  const merged=mergeSameDomain([[{period:'2024',ipca:4.5}],[{period:'2024',selic:10.5}]],'br-time');
  const joined=broadcastNationalTime([{cd_cvm:'1',ano:2024,roe:20}],merged,'company-year');
  assert(joined[0].ipca===4.5&&joined[0].selic===10.5,'juncao anual incorreta');
  const rows=[{empresa:'A',ano:2023,roe:10},{empresa:'B',ano:2023,roe:20},{empresa:'A',ano:2024,roe:30}];
  assert(numericColumns(rows).join(',')==='roe','colunas numericas incorretas');
  assert(summarizeTrend(rows,'roe')[0].value===15,'resumo do grafico incorreto');
  assert(parseComexTotals('"ARQUIVO";"CO_ANO";"VL_FOB"\n"EXP_2024.csv";"2024";337','exportacoes_usd')[0].exportacoes_usd===337,'parser Comex incorreto');
  assert(parseSnapshotTable('period;selic\n2024;10.5')[0].selic==='10.5','parser de recorte local incorreto');
  assert(parseNumber('1.693794003e+12')===1693794003000,'notação científica da CVM não foi lida');
  const macroMeasures=['bcb_selic','bcb_ipca','bcb_usd'].map(id=>getMeasure(ontology,id));
  const macroBase=await buildDataset(macroMeasures,{startYear:1995,endYear:new Date().getFullYear(),frequency:'annual',scope:'brazil',missing:'complete'});
  assert(macroBase.rows.length===new Date().getFullYear()-1995+1,'recorte macro possui anos ausentes');
  assert(macroBase.stats.localSnapshots===1,'macro não usou o recorte oficial local');
  const comexMeasures=['comex_exports','comex_imports'].map(id=>getMeasure(ontology,id));
  const comexBase=await buildDataset(comexMeasures,{startYear:1997,endYear:new Date().getFullYear(),frequency:'annual',scope:'brazil',missing:'complete'});
  assert(comexBase.rows.length>=29&&comexBase.stats.localSnapshots===2,'recorte Comex local incompleto');
  const financeMeasures=['cvm_roe','cvm_leverage','cvm_revenue_growth'].map(id=>getMeasure(ontology,id));
  const financeBase=await buildDataset(financeMeasures,{startYear:2021,endYear:new Date().getFullYear()-1,frequency:'annual',scope:'company',missing:'complete'});
  assert(financeBase.rows.length>2500&&financeBase.stats.localSnapshots===1,'recorte financeiro local incompleto');
  const everyFinance=ontology.measures.filter(measure=>measure.connector==='cvm-dfp');
  const financeAudit=await buildDataset(everyFinance,{startYear:2021,endYear:new Date().getFullYear()-1,frequency:'annual',scope:'company',missing:'keep'});
  for(const measure of everyFinance){
    const column=metricColumn(measure);
    assert(financeAudit.rows.filter(row=>Number.isFinite(row[column])).length>500,`${measure.label} ficou sem dados suficientes`);
  }
  const simple=Array.from({length:12},(_,index)=>({x:index+1,y:4+2*(index+1)}));
  assert(Math.abs(fitOLS(simple,{outcome:'y',regressors:['x']}).coefficients[1].estimate-2)<1e-8,'OLS incorreto');
  const panel=[];
  for(let entity=0;entity<4;entity++) for(let time=0;time<4;time++){const x=(entity+1)*(time+1);panel.push({empresa:`E${entity}`,ano:2020+time,x,y:10*entity+2*time+3*x});}
  assert(Math.abs(fitFixedEffects(panel,{outcome:'y',regressors:['x'],entity:'empresa',time:'ano'}).coefficients[0].estimate-3)<1e-7,'efeitos fixos incorretos');
  const didRows=[];
  for(const [unit,offset] of [['T',4],['C1',0],['C2',1],['C3',-1]]) for(let time=0;time<4;time++) didRows.push({empresa:unit,ano:2020+time,y:20+offset+2*time+(unit==='T'&&time>=2?5:0)});
  assert(Math.abs(fitDID(didRows,{outcome:'y',entity:'empresa',time:'ano',treatedValue:'T',intervention:'2022'}).coefficients[3].estimate-5)<1e-7,'DID incorreto');
  const dddRows=[];
  for(const [unit,offset] of [['T',4],['C1',0],['C2',1],['C3',-1]]) for(let time=0;time<4;time++) for(const group of [0,1]) dddRows.push({empresa:unit,ano:2020+time,grupo:group,y:20+offset+2*time+3*group+(unit==='T'&&time>=2&&group===1?7:0)});
  assert(Math.abs(fitDDD(dddRows,{outcome:'y',entity:'empresa',time:'ano',treatedValue:'T',intervention:'2022',groupColumn:'grupo',groupThreshold:.5}).coefficients[7].estimate-7)<1e-7,'DDD incorreto');
  assert(generateModelScript('r',{method:'fe',outcome:'y',regressors:['x'],entity:'empresa',time:'ano'}).includes('fixest::feols'),'script R ausente');
  result.textContent='PASS';
  document.documentElement.dataset.tests='pass';
}catch(error){
  result.textContent=`FAIL: ${error.message}`;
  document.documentElement.dataset.tests='fail';
  console.error(error);
}
