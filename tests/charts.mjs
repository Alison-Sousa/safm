import assert from 'node:assert/strict';
import { numericColumns, summarizeTrend, summarizeRanking } from '../assets/charts.js';

const rows=[
  {empresa:'A',ano:2023,roe:10,receita:100},
  {empresa:'B',ano:2023,roe:20,receita:200},
  {empresa:'A',ano:2024,roe:30,receita:150},
  {empresa:'B',ano:2024,roe:40,receita:250}
];
assert.deepEqual(numericColumns(rows),['roe','receita']);
assert.deepEqual(summarizeTrend(rows,'roe'),[
  {label:'2023',value:15,count:2},
  {label:'2024',value:35,count:2}
]);
assert.deepEqual(summarizeRanking(rows,'receita',2),[
  {label:'B',value:250,period:'2024'},
  {label:'A',value:150,period:'2024'}
]);
console.log('charts ok');
