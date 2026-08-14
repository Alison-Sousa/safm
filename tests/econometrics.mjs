import assert from 'node:assert/strict';
import { fitOLS, fitFixedEffects, fitDID, fitDDD, generateModelScript, numericModelColumns } from '../assets/econometrics.js';

const simple=Array.from({length:12},(_,index)=>({x:index+1,y:4+2*(index+1)}));
const ols=fitOLS(simple,{outcome:'y',regressors:['x']});
assert.ok(Math.abs(ols.coefficients.find(item=>item.term==='x').estimate-2)<1e-8);
assert.equal(ols.n,12);
assert.deepEqual(numericModelColumns(simple),['x','y']);

const panel=[];
for(let entity=0;entity<4;entity++) for(let time=0;time<4;time++){
  const x=(entity+1)*(time+1);
  panel.push({empresa:`E${entity}`,ano:2020+time,x,y:10*entity+2*time+3*x});
}
const fe=fitFixedEffects(panel,{outcome:'y',regressors:['x'],entity:'empresa',time:'ano'});
assert.ok(Math.abs(fe.coefficients[0].estimate-3)<1e-7);

const didRows=[];
for(const [unit,offset] of [['T',4],['C1',0],['C2',1],['C3',-1]]) for(let time=0;time<4;time++){
  didRows.push({empresa:unit,ano:2020+time,y:20+offset+2*time+(unit==='T'&&time>=2?5:0)});
}
const did=fitDID(didRows,{outcome:'y',entity:'empresa',time:'ano',treatedValue:'T',intervention:'2022'});
assert.ok(Math.abs(did.coefficients.find(item=>item.term.startsWith('DID')).estimate-5)<1e-7);
const dddRows=[];
for(const [unit,offset] of [['T',4],['C1',0],['C2',1],['C3',-1]]) for(let time=0;time<4;time++) for(const group of [0,1]){
  dddRows.push({empresa:unit,ano:2020+time,grupo:group,y:20+offset+2*time+3*group+(unit==='T'&&time>=2&&group===1?7:0)});
}
const ddd=fitDDD(dddRows,{outcome:'y',entity:'empresa',time:'ano',treatedValue:'T',intervention:'2022',groupColumn:'grupo',groupThreshold:.5});
assert.ok(Math.abs(ddd.coefficients.find(item=>item.term.startsWith('DDD')).estimate-7)<1e-7);
assert.match(generateModelScript('r',{method:'fe',outcome:'y',regressors:['x'],entity:'empresa',time:'ano'}),/fixest::feols/);
assert.match(generateModelScript('python',{method:'ols',outcome:'y',regressors:['x']}),/statsmodels/);
console.log('econometrics ok');
