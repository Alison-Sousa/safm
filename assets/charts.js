const ID_COLUMNS=new Set(['ano','period','periodo','cd_cvm','cnpj','geo_id']);

const METRIC_COLUMNS={
  roe:'roe',roa:'roa',leverage:'endividamento',current_ratio:'liquidez_corrente',
  operating_margin:'margem_operacional',cash:'caixa',revenue:'receita',assets:'ativo_total',
  net_income:'lucro_liquido',equity:'patrimonio_liquido',revenue_growth:'crescimento_receita',
  asset_growth:'crescimento_ativos'
};

const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function numericColumns(rows){
  const sample=rows.slice(0,300), columns=[...new Set(sample.flatMap(row=>Object.keys(row)))];
  return columns.filter(column=>{
    if(ID_COLUMNS.has(column)||/_id$|codigo|cnpj/i.test(column)) return false;
    const values=sample.map(row=>row[column]).filter(value=>value!==null&&value!==undefined&&value!=='');
    return values.length>0&&values.filter(value=>Number.isFinite(Number(value))).length/values.length>=.8;
  });
}

function periodColumn(rows){
  const first=rows[0]||{};
  return 'ano' in first?'ano':('periodo' in first?'periodo':('period' in first?'period':null));
}

export function summarizeTrend(rows,column){
  const period=periodColumn(rows), groups=new Map();
  if(!period) return [];
  for(const row of rows){
    const key=String(row[period]??''); const value=Number(row[column]);
    if(!key||!Number.isFinite(value)) continue;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(value);
  }
  return [...groups.entries()].map(([label,values])=>({label,value:values.reduce((a,b)=>a+b,0)/values.length,count:values.length})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
}

export function summarizeRanking(rows,column,limit=12){
  const period=periodColumn(rows), nameKey=rows.some(r=>r.empresa)?'empresa':(rows.some(r=>r.geo_nome)?'geo_nome':null);
  if(!nameKey) return [];
  const periods=period?[...new Set(rows.map(r=>String(r[period]??'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})):[];
  const latest=periods.at(-1);
  return rows.filter(row=>!period||String(row[period])===latest).map(row=>({label:String(row[nameKey]||'Sem nome'),value:Number(row[column]),period:latest})).filter(x=>Number.isFinite(x.value)).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,limit);
}

function format(value){
  return new Intl.NumberFormat('pt-BR',{notation:Math.abs(value)>=1e9?'compact':'standard',maximumFractionDigits:2}).format(value);
}

function lineSvg(points){
  if(!points.length) return '<div class="chart-empty">Sem valores numéricos para esta visualização.</div>';
  const width=760,height=280,pad={l:62,r:22,t:22,b:42};
  const values=points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
  const x=i=>pad.l+(i/Math.max(1,points.length-1))*(width-pad.l-pad.r);
  const y=v=>pad.t+(1-(v-min)/span)*(height-pad.t-pad.b);
  const path=points.map((p,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const ticks=[0,.25,.5,.75,1].map(t=>{const value=max-span*t,py=pad.t+t*(height-pad.t-pad.b);return `<g><line x1="${pad.l}" y1="${py}" x2="${width-pad.r}" y2="${py}"/><text x="${pad.l-9}" y="${py+3}" text-anchor="end">${esc(format(value))}</text></g>`;}).join('');
  const labels=points.map((p,i)=>i===0||i===points.length-1||i%Math.ceil(points.length/6)===0?`<text x="${x(i)}" y="${height-15}" text-anchor="middle">${esc(p.label)}</text>`:'').join('');
  const circles=points.map((p,i)=>`<circle class="data-point" tabindex="0" cx="${x(i)}" cy="${y(p.value)}" r="4" data-label="${esc(p.label)}" data-value="${esc(format(p.value))}" data-count="${p.count}"/>`).join('');
  return `<svg class="data-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução da variável"><g class="chart-grid">${ticks}</g><path class="trend-line" d="${path}"/>${circles}<g class="chart-axis">${labels}</g></svg>`;
}

function barSvg(points){
  if(!points.length) return '<div class="chart-empty">Este recorte não possui unidades para comparar.</div>';
  const width=760,row=28,pad=220,height=points.length*row+24,max=Math.max(...points.map(p=>Math.abs(p.value)))||1;
  const bars=points.map((p,i)=>{const y=i*row+9,w=Math.abs(p.value)/max*(width-pad-34);return `<g><text x="${pad-10}" y="${y+12}" text-anchor="end">${esc(p.label.slice(0,31))}</text><rect class="data-point" tabindex="0" x="${pad}" y="${y}" width="${Math.max(2,w)}" height="16" rx="5" data-label="${esc(p.label)}" data-value="${esc(format(p.value))}"/><text x="${pad+w+7}" y="${y+12}">${esc(format(p.value))}</text></g>`;}).join('');
  return `<svg class="data-chart ranking-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Comparação no período mais recente">${bars}</svg>`;
}

function labelsFor(measures){
  const labels={};
  for(const measure of measures){labels[METRIC_COLUMNS[measure.metric]||measure.metric]=measure.label;}
  return labels;
}

export function mountDataExplorer(host,rows,measures=[]){
  if(!host) return;
  const columns=numericColumns(rows),labels=labelsFor(measures);
  if(!columns.length){host.innerHTML='';return;}
  host.innerHTML=`<section class="data-explorer"><div class="explorer-head"><div><small>Explore antes de baixar</small><h4>Visualização interativa</h4></div><label><span>Variável</span><select data-chart-metric>${columns.map(c=>`<option value="${esc(c)}">${esc(labels[c]||c.replaceAll('_',' '))}</option>`).join('')}</select></label></div><div class="chart-modes"><button type="button" class="active" data-chart-mode="trend">Evolução</button><button type="button" data-chart-mode="ranking">Maiores valores</button></div><div class="chart-stage" data-chart-stage></div><div class="chart-tooltip" data-chart-tooltip hidden></div></section>`;
  let mode='trend';
  const metric=host.querySelector('[data-chart-metric]'),stage=host.querySelector('[data-chart-stage]'),tooltip=host.querySelector('[data-chart-tooltip]');
  const render=()=>{
    const points=mode==='trend'?summarizeTrend(rows,metric.value):summarizeRanking(rows,metric.value);
    stage.innerHTML=mode==='trend'?lineSvg(points):barSvg(points);
    stage.querySelectorAll('.data-point').forEach(point=>{
      const show=()=>{tooltip.hidden=false;tooltip.textContent=`${point.dataset.label}: ${point.dataset.value}${point.dataset.count?` · média de ${point.dataset.count} observações`:''}`;};
      point.addEventListener('mouseenter',show);point.addEventListener('focus',show);
      point.addEventListener('mouseleave',()=>{tooltip.hidden=true;});point.addEventListener('blur',()=>{tooltip.hidden=true;});
    });
  };
  metric.addEventListener('change',render);
  host.querySelectorAll('[data-chart-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.chartMode;host.querySelectorAll('[data-chart-mode]').forEach(b=>b.classList.toggle('active',b===button));render();}));
  render();
}
