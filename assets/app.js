import { analyzeQuery, getMeasure, getSource, commonConfig, suggestedControls, resolvedStartYear, resolvedEndYear, readyDimensions } from './engine.js';
import { buildDataset } from './connectors.js';
import { downloadCSV, downloadXLSX, downloadParquet } from './exporters.js';
import { mountDataExplorer } from './charts.js';
import { mountEconometricsLab } from './econometrics.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const state={ontology:null,intent:null,selected:new Set(),built:null,buildConfig:null,liveTimer:null};
const currentYear=new Date().getFullYear();

const escapeHtml=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtInt=n=>new Intl.NumberFormat('pt-BR').format(Number(n)||0);
const sourceName=id=>getSource(state.ontology,id)?.short||id.toUpperCase();
const frequencyLabel=f=>({daily:'Diária',monthly:'Mensal',quarterly:'Trimestral',annual:'Anual',bimonthly:'Bimestral',four_monthly:'Quadrimestral'})[f]||f;
const domainLabel=d=>({'company-year':'Companhia × ano','br-time':'Brasil × período','geo-year':'Território × ano','geo-time':'Território × período','team-year':'Clube × ano','club-year':'Clube × ano',match:'Partida'})[d]||d;

async function init(){
  const response=await fetch('./data/ontology.json',{cache:'no-store'});
  state.ontology=await response.json();
  renderSources();
  bindUI();
  const q=new URLSearchParams(location.search).get('q');
  if(q){ $('#researchInput').value=q; analyze(q); }
}

function bindUI(){
  $('#researchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#researchInput').value.trim();if(q) analyze(q);});
  $('#researchInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter') $('#researchForm').requestSubmit();});
  $('#researchInput').addEventListener('input',e=>{
    clearTimeout(state.liveTimer);
    state.liveTimer=setTimeout(()=>renderLiveAssist(e.target.value),180);
  });
  $$('.example-chip').forEach(b=>b.addEventListener('click',()=>{$('#researchInput').value=b.dataset.example;$('#researchForm').requestSubmit();}));
  $('#openAbout').addEventListener('click',()=>$('#aboutDialog').showModal());
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
}

function renderLiveAssist(query){
  const host=$('#liveAssist'); if(!host) return;
  const text=String(query||'').trim();
  if(text.length<3){host.innerHTML='';return;}
  const preview=analyzeQuery(text,state.ontology);
  const dims=preview.dimensions.length?preview.dimensions:preview.suggestedDimensions.slice(0,3);
  if(!dims.length){host.innerHTML='<span class="assist-status">Não vou chutar um tema errado.</span><small>Continue descrevendo: população, período, lugar ou indicador ajudam.</small>';return;}
  host.innerHTML=`<span class="assist-status">${preview.dimensions.length?'Entendendo':'Talvez seja'}</span><div>${dims.map(d=>`<button type="button" data-live-theme="${d.id}">${escapeHtml(d.label)}</button>`).join('')}</div><small>${preview.confidenceLevel==='high'?'Boa correspondência':'Adicione um pouco mais de contexto para confirmar'}</small>`;
  $$('[data-live-theme]',host).forEach(button=>button.addEventListener('click',()=>{$('#researchForm').requestSubmit();}));
}

function analyze(query){
  state.intent=analyzeQuery(query,state.ontology);
  state.selected.clear(); state.built=null;
  for(const dm of state.intent.directMeasures){
    const m=getMeasure(state.ontology,dm.id);
    if(m?.build && dm.score>=20) state.selected.add(m.id);
  }
  renderWorkflow();
  setTimeout(()=>$('#workflow')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
}

function interpretationTitle(){
  const dims=state.intent.dimensions.map(d=>d.label);
  if(!dims.length) return 'Escolha o caminho mais próximo da sua pesquisa.';
  if(dims.length===1) return dims[0];
  if(dims.length===2) return `${dims[0]} × ${dims[1]}`;
  return `${dims[0]} + ${dims[1]} + ${dims[2]}`;
}

function measureCard(m){
  const src=getSource(state.ontology,m.source);
  const selected=state.selected.has(m.id);
  const latest=resolvedEndYear(m);
  const coverage=`${resolvedStartYear(m)}–${m.endYear==='source'?'fonte atual':latest}`;
  const content=`
    <span class="measure-check">${selected?'✓':'+'}</span>
    <span class="measure-main"><strong>${escapeHtml(m.label)}</strong><small>${escapeHtml(m.description)}</small></span>
    <span class="measure-meta"><em style="--source:${src?.accent||'#6ee7b7'}">${escapeHtml(src?.short||m.source)}</em><span>${coverage}</span><span>${m.frequencies.map(frequencyLabel).join(' · ')}</span></span>
    <span class="route-badge">montagem automática</span>`;
  return `<button type="button" class="measure-card ${selected?'selected':''}" data-measure="${m.id}" aria-pressed="${selected}">${content}</button>`;
}

function dimensionMeasures(dim){
  const direct=new Map(state.intent.directMeasures.map(x=>[x.id,x.score]));
  return dim.measures.map(id=>getMeasure(state.ontology,id)).filter(m=>m?.build&&m.connector).sort((a,b)=>(direct.get(b.id)||0)-(direct.get(a.id)||0));
}

function renderWorkflow(){
  const area=$('#workflowArea');
  const dims=state.intent.dimensions;
  if(!dims.length){
    const suggested=state.intent.suggestedDimensions||[];
    const terms=state.intent.unmatchedTerms||[];
    const catalogUrl=`https://dados.gov.br/dados/conjuntos-dados?nomeConjuntoDados=${encodeURIComponent(state.intent.query)}`;
    area.innerHTML=`<section id="workflow" class="workflow empty-workflow"><div class="understood cautious"><span>Escopo validado</span><h2>Esse tema ainda não tem montagem automática segura.</h2><p>${terms.length?`Termos que precisam de contexto ou conector: ${escapeHtml(terms.join(', '))}. `:''}A página principal só oferece áreas que entregam uma base pronta. Escolha uma delas ou consulte o catálogo oficial.</p>${suggested.length?`<div class="intent-pills"><span>Talvez: ${suggested.map(d=>escapeHtml(d.label)).join(' · ')}</span></div>`:''}</div><div class="theme-grid">${readyDimensions(state.ontology).map(d=>`<button class="theme-choice" data-theme="${d.id}">${escapeHtml(d.label)}</button>`).join('')}</div><a class="catalog-route" href="${catalogUrl}" target="_blank" rel="noopener"><span>Assunto fora dos conectores validados?</span><strong>Pesquisar no catálogo oficial dados.gov.br ↗</strong></a></section>`;
    $$('.theme-choice',area).forEach(b=>b.addEventListener('click',()=>{state.intent.dimensions=[readyDimensions(state.ontology).find(d=>d.id===b.dataset.theme)];renderWorkflow();}));
    return;
  }
  const confidenceText=state.intent.confidenceLevel==='high'?'interpretação forte':state.intent.confidenceLevel==='medium'?'confirme as opções':'interpretação cautelosa';
  area.innerHTML=`<section id="workflow" class="workflow">
    <div class="understood">
      <span>Entendi assim · ${confidenceText}</span>
      <h2>${escapeHtml(interpretationTitle())}</h2>
      <p>Todas as medidas abaixo têm conector oficial validado e levam a uma base montável.</p>
      <div class="intent-pills"><span>${Math.round(state.intent.confidence*100)}% de aderência lexical</span>${state.intent.years.start?`<span>${state.intent.years.start} → ${state.intent.years.end||currentYear}</span>`:''}${state.intent.requestedFrequency?`<span>${frequencyLabel(state.intent.requestedFrequency)}</span>`:''}${state.intent.requestedGeo?`<span>${geoText(state.intent.requestedGeo)}</span>`:''}</div>
    </div>
    <div class="dimension-grid ${dims.length===1?'single':''}">${dims.map(dim=>{const measures=dimensionMeasures(dim),ready=measures.length;return `<section class="dimension-block"><div class="dimension-head"><span>${escapeHtml(dim.label)}</span><h3>${escapeHtml(dim.question)}</h3><small>${ready} ${ready===1?'variável pronta':'variáveis prontas'} para montar</small></div><div class="measure-grid">${measures.map(measureCard).join('')}</div></section>`;}).join('')}</div>
    <div id="builderArea"></div>
  </section>`;
  $$('.measure-card[data-measure]',area).forEach(card=>card.addEventListener('click',()=>toggleMeasure(card.dataset.measure)));
  renderBuilder();
}

function geoText(g){ return ({municipality:'Municípios',state:'Estados / UF',brazil:'Brasil'})[g]||'Brasil'; }

function toggleMeasure(id){
  if(state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  state.built=null;
  const card=$(`[data-measure="${CSS.escape(id)}"]`);
  if(card){
    const on=state.selected.has(id); card.classList.toggle('selected',on);card.setAttribute('aria-pressed',String(on));$('.measure-check',card).textContent=on?'✓':'+';
  }
  renderBuilder();
}

function getSelectedMeasures(){return [...state.selected].map(id=>getMeasure(state.ontology,id)).filter(Boolean);}

function renderBuilder(){
  const host=$('#builderArea'); if(!host) return;
  const measures=getSelectedMeasures();
  if(!measures.length){
    const hasReady=state.intent.dimensions.some(dim=>dim.measures.some(id=>getMeasure(state.ontology,id)?.build));
    host.innerHTML=hasReady?`<div class="builder-placeholder"><span>1</span><p>Escolha pelo menos uma medida com montagem automática para continuar.</p></div>`:`<div class="builder-placeholder route-placeholder"><span>↗</span><p>Este tema já tem fontes oficiais mapeadas, mas ainda não um conector validado. Abra uma medida acima para consultar a origem.</p></div>`;
    return;
  }
  const cfg=commonConfig(measures,state.intent);
  const unsupported=measures.filter(m=>!m.build);
  const controls=suggestedControls(state.ontology,measures);
  if(cfg.mixedDomain){
    host.innerHTML=`<div class="builder-warning"><strong>Essas medidas pertencem a unidades diferentes.</strong><p>Para uma base limpa, escolha medidas que tenham a mesma unidade de observação.</p></div>`;return;
  }
  const requestedFreq=state.intent.requestedFrequency;
  const freq=(requestedFreq&&cfg.frequencies.includes(requestedFreq))?requestedFreq:(cfg.frequencies.includes('annual')?'annual':cfg.frequencies[0]);
  const scope=defaultScope(measures,state.intent.requestedGeo);
  const longCvm=measures.some(m=>m.connector==='cvm-dfp') && (cfg.defaultEnd-cfg.defaultStart+1)>8;
  host.innerHTML=`<section class="builder-card">
    <div class="builder-title"><div><span>Próximo passo</span><h3>Monte a base</h3></div><div class="selection-count">${measures.length} ${measures.length===1?'variável':'variáveis'}</div></div>
    <div class="selected-strip">${measures.map(m=>`<span>${escapeHtml(m.label)}<button type="button" data-remove="${m.id}" aria-label="Remover ${escapeHtml(m.label)}">×</button></span>`).join('')}</div>
    ${unsupported.length?`<div class="availability-note"><strong>${unsupported.map(m=>escapeHtml(m.label)).join(', ')}</strong> ${unsupported.length===1?'ainda está disponível apenas como caminho para a fonte oficial.':'ainda estão disponíveis apenas como caminho para as fontes oficiais.'}</div>`:''}
    <div class="builder-fields">
      <label><span>De</span><input id="startYear" type="number" min="${cfg.start}" max="${cfg.end}" value="${cfg.defaultStart}"></label>
      <label><span>Até</span><input id="endYear" type="number" min="${cfg.start}" max="${cfg.end}" value="${cfg.defaultEnd}"></label>
      <label><span>Frequência</span><select id="frequencySelect">${cfg.frequencies.map(f=>`<option value="${f}" ${f===freq?'selected':''}>${frequencyLabel(f)}</option>`).join('')}</select></label>
      ${scopeField(cfg.domain,measures,scope)}
      <label><span>Dados ausentes</span><select id="missingSelect"><option value="complete" selected>Somente linhas completas</option><option value="keep">Manter vazios (avançado)</option></select></label>
    </div>
    ${longCvm?'<p class="soft-note">Períodos longos de companhias abertas usam vários arquivos anuais da CVM. O site consulta os anos em paralelo para reduzir a espera.</p>':''}
    ${controls.length?`<div class="control-suggestions"><div><span>Talvez ajude</span><p>Controles comuns para esse tipo de base</p></div><div>${controls.map(m=>`<button type="button" data-control="${m.id}">+ ${escapeHtml(m.label)}</button>`).join('')}</div></div>`:''}
    <div id="buildMessage"></div>
    <button id="buildButton" class="build-button" type="button" ${unsupported.length?'disabled':''}><span class="build-icon">↗</span><span><strong>Montar base</strong><small>buscar dados nas fontes e organizar</small></span><b>→</b></button>
    <div id="outputArea"></div>
  </section>`;
  $$('[data-remove]',host).forEach(b=>b.addEventListener('click',()=>toggleMeasure(b.dataset.remove)));
  $$('[data-control]',host).forEach(b=>b.addEventListener('click',()=>{state.selected.add(b.dataset.control);renderWorkflow();}));
  $('#buildButton')?.addEventListener('click',()=>startBuild(cfg));
  if(state.built) renderOutput();
}

function defaultScope(measures,requested){
  if(measures[0]?.domain==='company-year') return 'company';
  if(measures[0]?.domain==='br-time') return 'brazil';
  const allGeo=measures.filter(m=>m.geo).map(m=>m.geo);
  if(requested && allGeo.every(arr=>arr.includes(requested))) return requested;
  return allGeo.every(arr=>arr.includes('municipality'))?'municipality':allGeo[0]?.[0]||'brazil';
}

function scopeField(domain,measures,current){
  if(domain==='company-year') return `<label><span>Unidade</span><select id="scopeSelect" disabled><option value="company">Companhias abertas</option></select></label>`;
  if(domain==='br-time') return `<label><span>Recorte</span><select id="scopeSelect" disabled><option value="brazil">Brasil</option></select></label>`;
  const opts=['municipality','state','brazil'].filter(g=>measures.every(m=>!m.geo||m.geo.includes(g)));
  return `<label><span>Recorte</span><select id="scopeSelect">${opts.map(g=>`<option value="${g}" ${g===current?'selected':''}>${geoText(g)}</option>`).join('')}</select></label>`;
}

async function startBuild(cfg){
  const measures=getSelectedMeasures();
  const start=Number($('#startYear').value), end=Number($('#endYear').value);
  const message=$('#buildMessage');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end){message.innerHTML='<div class="build-error">Confira o período escolhido.</div>';return;}
  const config={startYear:start,endYear:end,frequency:$('#frequencySelect').value,scope:$('#scopeSelect').value,missing:$('#missingSelect').value};
  state.buildConfig=config; state.built=null;
  const button=$('#buildButton'); button.disabled=true; button.classList.add('loading');
  const t0=performance.now();
  message.innerHTML=`<div class="build-progress"><div class="progress-line"><i></i></div><strong id="progressText">Preparando as consultas…</strong><span id="progressSub">Só entram na base os dados recebidos das fontes.</span></div>`;
  try{
    const result=await buildDataset(measures,config,p=>{
      const el=$('#progressText'); if(el&&p.message) el.textContent=p.message;
    });
    if(!result.rows.length) throw new Error('A consulta terminou sem linhas para o período escolhido.');
    state.built={...result,measures,seconds:(performance.now()-t0)/1000};
    message.innerHTML=''; renderOutput();
  }catch(err){
    message.innerHTML=`<div class="build-error"><strong>Não consegui montar essa base agora.</strong><span>${escapeHtml(err.message||'A fonte não respondeu.')}</span></div>`;
  }finally{button.disabled=false;button.classList.remove('loading');}
}

function filename(ext){
  const date=new Date().toISOString().slice(0,10); return `safm_${date}.${ext}`;
}

function renderOutput(){
  const host=$('#outputArea'); if(!host||!state.built) return;
  const {rows,measures,seconds,domain,stats,quality}=state.built;
  const cols=[...new Set(rows.slice(0,2000).flatMap(r=>Object.keys(r)))];
  const srcs=[...new Set(measures.map(m=>sourceName(m.source)))];
  host.innerHTML=`<section class="output-card">
    <div class="output-success"><span>✓</span><div><small>Base pronta</small><h3>${fmtInt(rows.length)} linhas · ${cols.length} colunas</h3><p>${domainLabel(domain)} · ${srcs.join(' + ')} · ${seconds<1?'menos de 1 s':`${seconds.toFixed(1).replace('.',',')} s`}</p></div></div>
    <div class="provenance-strip"><span>Fontes: ${srcs.join(' + ')}</span><span>${stats?.localSnapshots?'recorte oficial incluído no site':stats?.cacheHits?`${fmtInt(stats.cacheHits)} consultas reaproveitadas`:'consulta nova às fontes'}</span><span>gerada em ${new Date(state.built.builtAt||Date.now()).toLocaleString('pt-BR')}</span></div>
    <div class="quality-strip"><strong>Qualidade auditada</strong><span>${fmtInt(rows.length)} linhas entregues</span><span>${quality?.droppedRows?`${fmtInt(quality.droppedRows)} linhas incompletas removidas`:'nenhuma linha incompleta nas variáveis escolhidas'}</span></div>
    <div id="dataExplorer"></div>
    <div id="econometricsLab"></div>
    <div class="format-title"><strong>Como você quer baixar?</strong><span>O conteúdo é o mesmo; muda apenas o formato do arquivo.</span></div>
    <div class="format-grid">
      <button class="format-card recommended" data-export="xlsx"><span class="format-icon">▦</span><div><strong>Excel</strong><small>Melhor para abrir e editar</small></div><em>.xlsx</em></button>
      <button class="format-card" data-export="csv"><span class="format-icon">≡</span><div><strong>CSV</strong><small>R, Python, Stata e outros</small></div><em>.csv</em></button>
      <button class="format-card" data-export="parquet"><span class="format-icon">◆</span><div><strong>Parquet</strong><small>Mais leve para bases grandes</small></div><em>.parquet</em></button>
    </div>
    <div id="exportMessage"></div>
    ${previewTable(rows,cols)}
  </section>`;
  mountDataExplorer($('#dataExplorer',host),rows,measures);
  mountEconometricsLab($('#econometricsLab',host),rows,{domain});
  $$('[data-export]',host).forEach(b=>b.addEventListener('click',()=>exportBuilt(b.dataset.export,b)));
}

function previewTable(rows,cols){
  const visible=cols.slice(0,8), sample=rows.slice(0,6);
  return `<details class="preview"><summary>Ver uma amostra da base</summary><div class="table-scroll"><table><thead><tr>${visible.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${sample.map(r=>`<tr>${visible.map(c=>`<td>${escapeHtml(formatCell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function formatCell(v){if(v===null||v===undefined||v==='')return '—';if(typeof v==='number')return Math.abs(v)>=1000?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(v):new Intl.NumberFormat('pt-BR',{maximumFractionDigits:4}).format(v);return String(v);}

async function exportBuilt(format,button){
  if(!state.built) return;
  const msg=$('#exportMessage'); const original=button.innerHTML; button.disabled=true; button.classList.add('working');
  try{
    if(format==='csv') downloadCSV(state.built.rows,filename('csv'));
    else if(format==='xlsx') await downloadXLSX(state.built.rows,filename('xlsx'));
    else await downloadParquet(state.built.rows,filename('parquet'));
    msg.innerHTML=`<div class="export-ok">Arquivo preparado.</div>`;
  }catch(err){msg.innerHTML=`<div class="build-error"><span>${escapeHtml(err.message||'Não foi possível gerar esse formato agora.')}</span></div>`;}
  finally{button.disabled=false;button.classList.remove('working');button.innerHTML=original;}
}

function renderSources(){
  const automatic=new Set(state.ontology.measures.filter(m=>m.build).map(m=>m.source));
  const ready=state.ontology.sources.filter(source=>automatic.has(source.id));
  $('#sourceCount').textContent=`${ready.length} fontes oficiais com montagem automática`;
  $('#sourceGrid').innerHTML=ready.map(s=>`<a class="source-card" href="${s.url}" target="_blank" rel="noopener"><span class="source-dot" style="--dot:${s.accent}"></span><div><strong>${escapeHtml(s.short)}</strong><small>${escapeHtml(s.name)}</small></div><p>${escapeHtml(s.description)}</p><em class="source-status ready">automático</em><b>↗</b></a>`).join('');
}

init().catch(err=>{console.error(err);$('#workflowArea').innerHTML='<div class="fatal">Não foi possível iniciar o site.</div>';});
