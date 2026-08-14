import { getMeasure } from '../assets/engine.js';
import { buildDataset } from '../assets/connectors.js';

const result=document.querySelector('#result');
try{
  const ontology=await fetch('../data/ontology.json').then(response=>response.json());
  const measure=getMeasure(ontology,'bcb_ipca');
  const built=await buildDataset([measure],{startYear:2024,endYear:2024,frequency:'monthly',scope:'brazil',missing:'keep'});
  if(built.rows.length<12||!built.rows.every(row=>'ipca' in row)) throw new Error('BCB retornou uma série incompleta');
  result.textContent=`PASS ${built.rows.length} linhas`;
  document.documentElement.dataset.tests='pass';
}catch(error){
  result.textContent=`FAIL: ${error.message}`;
  document.documentElement.dataset.tests='fail';
  console.error(error);
}
