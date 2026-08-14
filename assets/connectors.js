import { normalize } from './engine.js';

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const pad = n => String(n).padStart(2,'0');
const currentYear = () => new Date().getFullYear();
const dataUrl = filename => new URL(`../data/${filename}`,import.meta.url).toString();
const requestMemo = new Map();
let requestStats = {networkRequests:0,cacheHits:0,localSnapshots:0};
const CACHE_TTL = 12*60*60*1000;

function timeoutSignal(ms=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return {signal:controller.signal, clear:()=>clearTimeout(timer)};
}

async function rawFetch(url, options={}){
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    const t=timeoutSignal(options.timeout||30000);
    try{
      requestStats.networkRequests++;
      const {timeout,...fetchOptions}=options;
      const response=await fetch(url,{...fetchOptions,signal:t.signal,cache:'no-store'});
      if(!response.ok){
        const retryable=response.status===429||response.status>=500;
        if(retryable&&attempt===0){await sleep(450);continue;}
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    }catch(error){
      lastError=error;
      if(attempt===0&&error?.name==='AbortError'){await sleep(350);continue;}
      throw error;
    }finally{t.clear();}
  }
  throw lastError;
}

function cacheId(url,type){
  let h=2166136261;
  for(const c of `${type}:${url}`){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  return `rd-${(h>>>0).toString(36)}`;
}

async function readPersistent(url,type){
  if(typeof caches==='undefined'||typeof location==='undefined') return undefined;
  try{
    const cache=await caches.open('rotadados-official-v2');
    const key=new URL(`/__rotadados_cache__/${cacheId(url,type)}`,location.origin).toString();
    const hit=await cache.match(key);
    if(!hit) return undefined;
    const saved=Number(hit.headers.get('x-rotadados-saved'));
    if(!saved||Date.now()-saved>CACHE_TTL){await cache.delete(key);return undefined;}
    requestStats.cacheHits++;
    if(type==='arrayBuffer') return await hit.arrayBuffer();
    if(type==='text') return await hit.text();
    return await hit.json();
  }catch(_){return undefined;}
}

async function writePersistent(url,type,data){
  if(typeof caches==='undefined'||typeof location==='undefined'||typeof Response==='undefined') return;
  try{
    const size=type==='arrayBuffer'?data.byteLength:JSON.stringify(data).length;
    if(size>17_000_000) return;
    const cache=await caches.open('rotadados-official-v2');
    const key=new URL(`/__rotadados_cache__/${cacheId(url,type)}`,location.origin).toString();
    const body=type==='arrayBuffer'?data:(type==='text'?data:JSON.stringify(data));
    await cache.put(key,new Response(body,{headers:{'content-type':type==='json'?'application/json':'application/octet-stream','x-rotadados-saved':String(Date.now())}}));
  }catch(_){ }
}

async function decodeResponse(response,type){
  if(type==='arrayBuffer') return await response.arrayBuffer();
  if(type==='text') return await response.text();
  return await response.json();
}

async function fetchProxyChunks(url){
  const chunkSize=2_000_000;
  const base=`/.netlify/functions/proxy?url=${encodeURIComponent(url)}`;
  const first=await rawFetch(`${base}&start=0&end=${chunkSize-1}`,{timeout:70000});
  const firstBuffer=await first.arrayBuffer();
  const range=first.headers.get('content-range')||'';
  const match=range.match(/\/(\d+)$/);
  if(!match) return firstBuffer;
  const total=Number(match[1]);
  const ranges=[];
  for(let start=chunkSize;start<total;start+=chunkSize) ranges.push([start,Math.min(total-1,start+chunkSize-1)]);
  const rest=await mapLimit(ranges,3,async([start,end])=>{
    const response=await rawFetch(`${base}&start=${start}&end=${end}`,{timeout:70000});
    return new Uint8Array(await response.arrayBuffer());
  });
  const output=new Uint8Array(total); let offset=0;
  for(const part of [new Uint8Array(firstBuffer),...rest]){output.set(part,offset);offset+=part.byteLength;}
  return output.buffer;
}

async function fetchOfficialUncached(url,type){
  try{
    const r=await rawFetch(url,{timeout:type==='arrayBuffer'?60000:30000});
    return await decodeResponse(r,type);
  }catch(firstError){
    if(type==='arrayBuffer'){
      try{return await fetchProxyChunks(url);}catch(_){ }
    }
    const proxy=`/.netlify/functions/proxy?url=${encodeURIComponent(url)}`;
    try{
      const r=await rawFetch(proxy,{timeout:type==='arrayBuffer'?70000:35000});
      return await decodeResponse(r,type);
    }catch(_){
      const local=typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname);
      const err=new Error(local&&type==='arrayBuffer'
        ? 'O recorte oficial local não foi encontrado. Restaure os arquivos da pasta data e tente novamente.'
        : 'A fonte oficial não respondeu agora. A consulta pode ser repetida sem perder suas escolhas.');
      err.cause=firstError;
      throw err;
    }
  }
}

async function fetchOfficial(url,type='json'){
  const key=`${type}:${url}`;
  if(requestMemo.has(key)){requestStats.cacheHits++;return await requestMemo.get(key);}
  const task=(async()=>{
    const cached=await readPersistent(url,type);
    if(cached!==undefined) return cached;
    const data=await fetchOfficialUncached(url,type);
    await writePersistent(url,type,data);
    return data;
  })();
  requestMemo.set(key,task);
  while(requestMemo.size>10){requestMemo.delete(requestMemo.keys().next().value);}
  try{return await task;}catch(error){requestMemo.delete(key);throw error;}
}

async function fetchViaProjectProxy(url,type='text'){
  const cached=await readPersistent(url,type);
  if(cached!==undefined) return cached;
  const proxy=`/.netlify/functions/proxy?url=${encodeURIComponent(url)}`;
  try{
    const response=await rawFetch(proxy,{timeout:35000}),data=await decodeResponse(response,type);
    await writePersistent(url,type,data);return data;
  }catch(error){
    const local=typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname);
    throw new Error(local?'O recorte oficial do comércio exterior não foi encontrado. Restaure os arquivos da pasta data e tente novamente.':'A fonte oficial de comércio exterior não respondeu agora.');
  }
}

async function fetchComexTable(localPath,officialUrl){
  try{
    const response=await rawFetch(localPath,{timeout:8000});
    requestStats.localSnapshots++;
    return await response.text();
  }catch(_){
    return await fetchViaProjectProxy(officialUrl,'text');
  }
}

function parseNumber(value){
  if(value===null || value===undefined || value==='') return null;
  const s=String(value).trim();
  if(['-','..','...','X','x'].includes(s)) return null;
  if(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(s)) return Number(s);
  const cleaned=s.replace(/\./g,'').replace(',','.').replace(/[^0-9+\-.]/g,'');
  const n=Number(cleaned); return Number.isFinite(n)?n:null;
}

function isoFromBR(date){
  const [d,m,y]=String(date).split('/');
  return y&&m&&d?`${y}-${m}-${d}`:String(date);
}

function yearChunks(start,end,maxYears=9){
  const out=[];
  for(let s=start;s<=end;s+=maxYears+1) out.push([s,Math.min(end,s+maxYears)]);
  return out;
}

async function mapLimit(items,limit,fn){
  const results=new Array(items.length); let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const i=cursor++; if(i>=items.length) break;
      results[i]=await fn(items[i],i);
    }
  });
  await Promise.all(workers); return results;
}

function periodKey(date,frequency){
  const d=new Date(`${date}T00:00:00Z`), y=d.getUTCFullYear(), m=d.getUTCMonth()+1;
  if(frequency==='annual') return String(y);
  if(frequency==='quarterly') return `${y}-Q${Math.ceil(m/3)}`;
  if(frequency==='monthly') return `${y}-${pad(m)}`;
  return date;
}

function aggregateSeries(points,frequency,mode='mean'){
  if(frequency==='daily') return points.map(p=>({period:p.date,value:p.value}));
  const groups=new Map();
  for(const p of points){
    const k=periodKey(p.date,frequency);
    if(!groups.has(k)) groups.set(k,[]);
    if(Number.isFinite(p.value)) groups.get(k).push(p.value);
  }
  return [...groups.entries()].map(([period,vals])=>{
    let value=null;
    if(vals.length){
      if(mode==='compound') value=(vals.reduce((acc,v)=>acc*(1+v/100),1)-1)*100;
      else if(mode==='last') value=vals[vals.length-1];
      else value=vals.reduce((a,b)=>a+b,0)/vals.length;
    }
    return {period,value};
  }).sort((a,b)=>a.period.localeCompare(b.period));
}

async function fetchBCBMeasure(measure,config,onProgress){
  const chunks=yearChunks(config.startYear,config.endYear,9);
  const pieces=await mapLimit(chunks,4,async([start,end],i)=>{
    onProgress?.({stage:'fetch',message:`Consultando ${measure.label}: ${start}–${end}`,done:i,total:chunks.length});
    const startDate=`01/01/${start}`, endDate=`31/12/${end}`;
    const url=`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${measure.series}/dados?formato=json&dataInicial=${encodeURIComponent(startDate)}&dataFinal=${encodeURIComponent(endDate)}`;
    const data=await fetchOfficial(url,'json');
    return Array.isArray(data)?data:[];
  });
  const points=pieces.flat().map(r=>({date:isoFromBR(r.data),value:parseNumber(r.valor)})).filter(r=>r.date && r.value!==null);
  return aggregateSeries(points,config.frequency,measure.aggregation||'mean').map(r=>({period:r.period,[measure.metric]:r.value}));
}

async function buildBCB(measures,config,onProgress){
  if(config.frequency==='annual'){
    try{
      onProgress?.({stage:'fetch',message:'Lendo o recorte oficial anual do Banco Central'});
      const snapshot=await fetchLocalSnapshot(dataUrl('bcb_annual.csv'));
      const wanted=measures.map(measure=>measure.metric);
      return snapshot
        .map(row=>Object.fromEntries([['period',row.period],...wanted.map(metric=>[metric,parseNumber(row[metric])])]))
        .filter(row=>Number(row.period)>=config.startYear&&Number(row.period)<=config.endYear)
        .filter(row=>wanted.some(metric=>row[metric]!==null))
        .sort((a,b)=>a.period.localeCompare(b.period));
    }catch(_){ /* A atualização on-line continua disponível se o recorte for removido. */ }
  }
  const series=await Promise.all(measures.map(m=>fetchBCBMeasure(m,config,onProgress)));
  const byPeriod=new Map();
  series.forEach((rows,idx)=>{
    const metric=measures[idx].metric;
    for(const row of rows){
      if(!byPeriod.has(row.period)) byPeriod.set(row.period,{period:row.period});
      byPeriod.get(row.period)[metric]=row[metric];
    }
  });
  return [...byPeriod.values()].sort((a,b)=>a.period.localeCompare(b.period));
}

export function parseComexTotals(text,metric){
  const lines=String(text||'').replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);
  if(lines.length<2) return [];
  const headers=parseDelimitedLine(lines[0]).map(value=>value.replace(/^"|"$/g,''));
  const yearIndex=headers.indexOf('CO_ANO'),valueIndex=headers.indexOf('VL_FOB');
  if(yearIndex<0||valueIndex<0) throw new Error('O layout do arquivo do MDIC mudou e precisa ser revisado.');
  return lines.slice(1).map(line=>{
    const cells=parseDelimitedLine(line),year=Number(cells[yearIndex]),value=parseNumber(cells[valueIndex]);
    return Number.isFinite(year)&&value!==null?{period:String(year),[metric]:value}:null;
  }).filter(Boolean);
}

async function buildComex(measures,config,onProgress){
  onProgress?.({stage:'fetch',message:'Consultando totais do comércio exterior no MDIC'});
  const base='https://balanca.mdic.gov.br/balanca/bd/comexstat-bd/ncm';
  const [exportsText,importsText]=await Promise.all([
    fetchComexTable(dataUrl('comex_exports.csv'),`${base}/EXP_TOTAIS_CONFERENCIA.csv`),
    fetchComexTable(dataUrl('comex_imports.csv'),`${base}/IMP_TOTAIS_CONFERENCIA.csv`)
  ]);
  const exportsRows=parseComexTotals(exportsText,'exportacoes_usd'),importsRows=parseComexTotals(importsText,'importacoes_usd');
  const byYear=new Map();
  for(const row of [...exportsRows,...importsRows]){
    if(!byYear.has(row.period)) byYear.set(row.period,{period:row.period});
    Object.assign(byYear.get(row.period),row);
  }
  const selected=new Set(measures.map(measure=>measure.metric));
  return [...byYear.values()].filter(row=>Number(row.period)>=config.startYear&&Number(row.period)<=config.endYear).map(row=>{
    const exportsValue=row.exportacoes_usd,importsValue=row.importacoes_usd;
    const complete={...row,saldo_comercial_usd:Number.isFinite(exportsValue)&&Number.isFinite(importsValue)?exportsValue-importsValue:null,corrente_comercio_usd:Number.isFinite(exportsValue)&&Number.isFinite(importsValue)?exportsValue+importsValue:null};
    return Object.fromEntries([['period',row.period],...measures.map(measure=>[measure.metric,complete[measure.metric]])]);
  }).filter(row=>[...selected].some(metric=>row[metric]!==null&&row[metric]!==undefined)).sort((a,b)=>a.period.localeCompare(b.period));
}

function flattenObjectArrays(obj){
  const out=[];
  const walk=v=>{
    if(Array.isArray(v)) v.forEach(walk);
    else if(v && typeof v==='object'){
      if(('id' in v || 'nome' in v) && ('unidade' in v || 'sumarizacao' in v || 'resultados' in v)) out.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(obj); return out;
}

async function ibgeMetadata(table){
  return await fetchOfficial(`https://servicodados.ibge.gov.br/api/v3/agregados/${table}/metadados`,'json');
}
async function ibgePeriods(table){
  const data=await fetchOfficial(`https://servicodados.ibge.gov.br/api/v3/agregados/${table}/periodos`,'json');
  return (Array.isArray(data)?data:[]).map(x=>Number(x.id||x.periodo||x)).filter(Number.isFinite);
}

function findIbgeVariable(metadata,needle){
  const target=normalize(needle);
  const candidates=(metadata?.variaveis || metadata?.variables || flattenObjectArrays(metadata)).filter(v=>v && (v.id!==undefined));
  let best=null,bestScore=-1;
  const targetWords=target.split(' ').filter(w=>w.length>2);
  for(const v of candidates){
    const label=normalize(v.nome||v.variavel||v.label||'');
    if(!label) continue;
    let score=0;
    if(label===target) score=100;
    else if(label.includes(target)||target.includes(label)) score=80;
    else score=targetWords.filter(w=>label.includes(w)).length;
    if(score>bestScore){bestScore=score;best=v;}
  }
  if(!best || bestScore<2) throw new Error(`Não encontrei a variável “${needle}” na tabela do IBGE.`);
  return String(best.id);
}

function ibgeGeoParam(scope){
  if(scope==='municipality') return 'N6[all]';
  if(scope==='state') return 'N3[all]';
  return 'N1[all]';
}

function flattenIbgeResponse(data,metric){
  const rows=[];
  for(const variable of (Array.isArray(data)?data:[])){
    for(const result of variable.resultados||[]){
      for(const series of result.series||[]){
        const loc=series.localidade||{};
        for(const [period,value] of Object.entries(series.serie||{})){
          rows.push({
            geo_id:String(loc.id||''),
            geo_nome:loc.nome||loc.name||'',
            periodo:String(period),
            [metric]:parseNumber(value)
          });
        }
      }
    }
  }
  return rows;
}

async function fetchIBGEMeasure(measure,config,onProgress){
  onProgress?.({stage:'metadata',message:`Preparando ${measure.label} no IBGE`});
  const [metadata,available]=await Promise.all([ibgeMetadata(measure.table),ibgePeriods(measure.table)]);
  const variableId=findIbgeVariable(metadata,measure.variableSearch);
  const years=[];
  for(let y=config.startYear;y<=config.endYear;y++) if(!available.length || available.includes(y)) years.push(y);
  if(!years.length) throw new Error(`${measure.label} não possui anos dentro do período escolhido.`);
  const groups=[];
  for(let i=0;i<years.length;i+=3) groups.push(years.slice(i,i+3));
  const pieces=await mapLimit(groups,3,async(chunk,i)=>{
    onProgress?.({stage:'fetch',message:`Consultando ${measure.label}: ${chunk[0]}–${chunk.at(-1)}`,done:i,total:groups.length});
    const periods=chunk.join('|'), locality=ibgeGeoParam(config.scope);
    const url=`https://servicodados.ibge.gov.br/api/v3/agregados/${measure.table}/periodos/${periods}/variaveis/${variableId}?localidades=${encodeURIComponent(locality)}`;
    const data=await fetchOfficial(url,'json');
    return flattenIbgeResponse(data,measure.metric);
  });
  return pieces.flat();
}

async function buildIBGE(measures,config,onProgress){
  const all=await Promise.all(measures.map(m=>fetchIBGEMeasure(m,config,onProgress)));
  const map=new Map();
  all.forEach((rows,idx)=>{
    const metric=measures[idx].metric;
    for(const r of rows){
      const key=`${r.geo_id}::${r.periodo}`;
      if(!map.has(key)) map.set(key,{geo_id:r.geo_id,geo_nome:r.geo_nome,periodo:r.periodo});
      map.get(key)[metric]=r[metric];
    }
  });
  return [...map.values()].sort((a,b)=>a.geo_id.localeCompare(b.geo_id)||a.periodo.localeCompare(b.periodo));
}

let fflatePromise=null;
async function loadFflate(){
  if(!fflatePromise) fflatePromise=import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
  return fflatePromise;
}

function parseDelimitedLine(line,delimiter=';'){
  const out=[]; let field='',quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(quoted && line[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(c===delimiter && !quoted){out.push(field);field='';}
    else field+=c;
  }
  out.push(field); return out;
}

export function parseSnapshotTable(text){
  const lines=String(text||'').replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);
  if(lines.length<2) throw new Error('O recorte oficial local está vazio.');
  const headers=parseDelimitedLine(lines[0]);
  return lines.slice(1).map(line=>{
    const cells=parseDelimitedLine(line);
    return Object.fromEntries(headers.map((header,index)=>[header,cells[index]??'']));
  });
}

async function fetchLocalSnapshot(path){
  const response=await rawFetch(path,{timeout:10000});
  const text=await response.text();
  const rows=parseSnapshotTable(text);
  requestStats.localSnapshots++;
  return rows;
}

const ACCOUNT_RULES={
  revenue:{codes:['3.01'],desc:[/receita de venda/i]},
  ebit:{codes:['3.05'],desc:[/resultado antes do resultado financeiro e dos tributos/i]},
  net_income:{codes:['3.11','3.09'],desc:[/lucro.*preju.*do per[ií]odo/i,/resultado l[ií]quido.*opera[cç][oõ]es continuadas/i]},
  assets:{codes:['1'],desc:[/^ativo total$/i]},
  equity:{codes:['2.03'],desc:[/patrim[oô]nio l[ií]quido$/i,/patrim[oô]nio l[ií]quido consolidado/i]},
  current_assets:{codes:['1.01'],desc:[/^ativo circulante$/i]},
  current_liabilities:{codes:['2.01'],desc:[/^passivo circulante$/i]},
  noncurrent_liabilities:{codes:['2.02'],desc:[/^passivo n[aã]o circulante$/i]},
  cash:{codes:['1.01.01'],desc:[/caixa e equivalentes de caixa/i]}
};

function neededRawMetrics(selectedMetrics){
  const set=new Set(selectedMetrics);
  const need=new Set();
  const add=(...xs)=>xs.forEach(x=>need.add(x));
  for(const m of set){
    if(['revenue','revenue_growth','operating_margin'].includes(m)) add('revenue');
    if(['assets','asset_growth','roa','leverage'].includes(m)) add('assets');
    if(['net_income','roe','roa'].includes(m)) add('net_income');
    if(['equity','roe'].includes(m)) add('equity');
    if(m==='current_ratio') add('current_assets','current_liabilities');
    if(m==='leverage') add('current_liabilities','noncurrent_liabilities');
    if(m==='operating_margin') add('ebit');
    if(m==='cash') add('cash');
  }
  return [...need];
}

function ruleMatch(raw,code,desc){
  const rule=ACCOUNT_RULES[raw]; if(!rule) return false;
  const c=String(code||'').trim(), d=String(desc||'').trim();
  if(rule.codes.some(x=>c===x)) return true;
  return rule.desc.some(re=>re.test(d));
}

function statementForRaw(raw){
  if(['revenue','ebit','net_income'].includes(raw)) return 'DRE';
  if(['assets','current_assets','cash'].includes(raw)) return 'BPA';
  return 'BPP';
}

function findZipFile(files,statement,year,kind){
  const keys=Object.keys(files);
  const exact=new RegExp(`${statement}_${kind}_${year}\\.csv$`,'i');
  return keys.find(k=>exact.test(k));
}

function decodeCvm(buffer){
  try{return new TextDecoder('windows-1252').decode(buffer);}catch(_){return new TextDecoder().decode(buffer);}
}

function parseCvmStatement(text,rawNeeded,scopeRank,year,targetMap){
  const lines=text.split(/\r?\n/); if(lines.length<2) return;
  const header=parseDelimitedLine(lines[0]).map(h=>normalize(h).replace(/\s+/g,'_'));
  const idx=name=>header.indexOf(normalize(name).replace(/\s+/g,'_'));
  const I={
    cd:idx('CD_CVM'),cnpj:idx('CNPJ_CIA'),name:idx('DENOM_CIA'),date:idx('DT_REFER'),version:idx('VERSAO'),order:idx('ORDEM_EXERC'),
    code:idx('CD_CONTA'),desc:idx('DS_CONTA'),value:idx('VL_CONTA'),scale:idx('ESCALA_MOEDA')
  };
  if(I.cd<0 || I.code<0 || I.value<0) return;
  for(let li=1;li<lines.length;li++){
    const line=lines[li]; if(!line) continue;
    const f=parseDelimitedLine(line); if(f.length<header.length-2) continue;
    if(I.order>=0 && normalize(f[I.order]) && normalize(f[I.order])!=='ultimo') continue;
    const raw=rawNeeded.find(r=>ruleMatch(r,f[I.code],I.desc>=0?f[I.desc]:''));
    if(!raw) continue;
    let value=parseNumber(f[I.value]); if(value===null) continue;
    const scale=I.scale>=0?normalize(f[I.scale]):'';
    if(scale.includes('mil')) value*=1000;
    const cd=String(f[I.cd]||'').trim(); if(!cd) continue;
    const rowYear=I.date>=0 && /\d{4}/.test(f[I.date]||'') ? Number(String(f[I.date]).slice(0,4)) : year;
    const key=`${cd}::${rowYear}`;
    if(!targetMap.has(key)) targetMap.set(key,{cd_cvm:cd,cnpj:I.cnpj>=0?f[I.cnpj]:'',empresa:I.name>=0?f[I.name]:'',ano:rowYear,_raw:{},_meta:{}});
    const target=targetMap.get(key), version=I.version>=0?Number(f[I.version])||0:0;
    const old=target._meta[raw];
    if(!old || scopeRank>old.scopeRank || (scopeRank===old.scopeRank && version>=old.version)){
      target._raw[raw]=value; target._meta[raw]={scopeRank,version};
      if(I.name>=0 && f[I.name]) target.empresa=f[I.name];
      if(I.cnpj>=0 && f[I.cnpj]) target.cnpj=f[I.cnpj];
    }
  }
}

async function fetchCvmYear(year,selectedMetrics,onProgress){
  onProgress?.({stage:'fetch',message:`CVM: demonstrações de ${year}`});
  const url=`https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_${year}.zip`;
  const buffer=await fetchOfficial(url,'arrayBuffer');
  const {unzipSync}=await loadFflate();
  const files=unzipSync(new Uint8Array(buffer));
  const rawNeeded=neededRawMetrics(selectedMetrics);
  const statements=[...new Set(rawNeeded.map(statementForRaw))];
  const map=new Map();
  for(const statement of statements){
    // Prefer consolidated statements. Individual statements fill companies without consolidated values.
    for(const [kind,rank] of [['ind',1],['con',2]]){
      const file=findZipFile(files,statement,year,kind);
      if(!file) continue;
      parseCvmStatement(decodeCvm(files[file]),rawNeeded.filter(r=>statementForRaw(r)===statement),rank,year,map);
      await sleep(0);
    }
  }
  return [...map.values()];
}

function safeRatio(a,b,mult=1){ return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(b)>1e-12 ? a/b*mult : null; }
function deriveCvm(rows,selectedMetrics){
  const byCompany=new Map();
  for(const r of rows){ if(!byCompany.has(r.cd_cvm)) byCompany.set(r.cd_cvm,[]); byCompany.get(r.cd_cvm).push(r); }
  const out=[];
  for(const companyRows of byCompany.values()){
    companyRows.sort((a,b)=>a.ano-b.ano);
    for(let i=0;i<companyRows.length;i++){
      const r=companyRows[i], raw=r._raw, prev=companyRows[i-1], prevRaw=prev?prev._raw:{};
      const row={cd_cvm:r.cd_cvm,cnpj:r.cnpj,empresa:r.empresa,ano:r.ano};
      for(const metric of selectedMetrics){
        if(metric==='revenue') row.receita=raw.revenue??null;
        else if(metric==='assets') row.ativo_total=raw.assets??null;
        else if(metric==='net_income') row.lucro_liquido=raw.net_income??null;
        else if(metric==='equity') row.patrimonio_liquido=raw.equity??null;
        else if(metric==='cash') row.caixa=raw.cash??null;
        else if(metric==='roe') row.roe=safeRatio(raw.net_income,raw.equity,100);
        else if(metric==='roa') row.roa=safeRatio(raw.net_income,raw.assets,100);
        else if(metric==='leverage') row.endividamento=safeRatio((raw.current_liabilities??0)+(raw.noncurrent_liabilities??0),raw.assets,100);
        else if(metric==='current_ratio') row.liquidez_corrente=safeRatio(raw.current_assets,raw.current_liabilities,1);
        else if(metric==='operating_margin') row.margem_operacional=safeRatio(raw.ebit,raw.revenue,100);
        else if(metric==='revenue_growth') row.crescimento_receita=(prev && r.ano-prev.ano===1)?safeRatio(raw.revenue-(prevRaw.revenue??NaN),prevRaw.revenue,100):null;
        else if(metric==='asset_growth') row.crescimento_ativos=(prev && r.ano-prev.ano===1)?safeRatio(raw.assets-(prevRaw.assets??NaN),prevRaw.assets,100):null;
      }
      if(Object.keys(row).length>4) out.push(row);
    }
  }
  return out.sort((a,b)=>a.cd_cvm.localeCompare(b.cd_cvm)||a.ano-b.ano);
}

async function buildCVM(measures,config,onProgress){
  const metrics=measures.map(m=>m.metric);
  try{
    onProgress?.({stage:'fetch',message:'Lendo o recorte oficial de companhias abertas da CVM'});
    const snapshot=await fetchLocalSnapshot(dataUrl('cvm_finance.csv'));
    const columns=metrics.map(metric=>METRIC_COLUMNS[metric]||metric);
    return snapshot
      .filter(row=>Number(row.ano)>=config.startYear&&Number(row.ano)<=config.endYear)
      .map(row=>{
        const output={cd_cvm:row.cd_cvm,cnpj:row.cnpj,empresa:row.empresa,ano:Number(row.ano)};
        for(const column of columns) output[column]=parseNumber(row[column]);
        return output;
      });
  }catch(_){ /* Mantém o conector remoto como recuperação para versões sem snapshot. */ }
  const needsPrevious=metrics.some(m=>m==='revenue_growth'||m==='asset_growth');
  const firstYear=needsPrevious?Math.max(2010,config.startYear-1):config.startYear;
  const years=[]; for(let y=firstYear;y<=config.endYear;y++) years.push(y);
  const pieces=await mapLimit(years,3,(year)=>fetchCvmYear(year,metrics,onProgress));
  return deriveCvm(pieces.flat(),metrics).filter(row=>row.ano>=config.startYear&&row.ano<=config.endYear);
}

function rowKey(row,domain){
  if(domain==='company-year') return `${row.cd_cvm}::${row.ano}`;
  if(domain==='geo-year'||domain==='geo-time') return `${row.geo_id}::${row.periodo}`;
  return String(row.period??row.periodo??row.ano??'');
}

function mergeSameDomain(parts,domain){
  const merged=new Map();
  for(const rows of parts) for(const row of rows){
    const key=rowKey(row,domain);
    if(!merged.has(key)) merged.set(key,{});
    Object.assign(merged.get(key),row);
  }
  return [...merged.values()].sort((a,b)=>rowKey(a,domain).localeCompare(rowKey(b,domain),undefined,{numeric:true}));
}

function broadcastNationalTime(detailRows,nationalRows,domain){
  const byYear=new Map();
  for(const row of nationalRows){
    const year=String(row.period??row.periodo??row.ano??'').slice(0,4);
    if(year) byYear.set(year,row);
  }
  return detailRows.map(row=>{
    const year=String(domain==='company-year'?row.ano:row.periodo).slice(0,4);
    const national=byYear.get(year)||{};
    const {period,...metrics}=national;
    return {...row,...metrics};
  });
}

const METRIC_COLUMNS={
  roe:'roe',roa:'roa',leverage:'endividamento',current_ratio:'liquidez_corrente',operating_margin:'margem_operacional',cash:'caixa',
  revenue:'receita',assets:'ativo_total',net_income:'lucro_liquido',equity:'patrimonio_liquido',revenue_growth:'crescimento_receita',asset_growth:'crescimento_ativos'
};

export function metricColumn(measure){ return METRIC_COLUMNS[measure.metric]||measure.metric; }

export function completeRows(rows,measures){
  return rows.filter(row=>measures.every(measure=>{
    const value=row[metricColumn(measure)];
    return value!==null&&value!==undefined&&value!==''&&!(typeof value==='number'&&Number.isNaN(value));
  }));
}

export function auditRows(rows,measures){
  const missingByMeasure={};
  for(const measure of measures){
    const column=metricColumn(measure);
    missingByMeasure[column]=rows.reduce((total,row)=>{
      const value=row[column];
      return total+Number(value===null||value===undefined||value===''||(typeof value==='number'&&Number.isNaN(value)));
    },0);
  }
  const complete=completeRows(rows,measures).length;
  return {rawRows:rows.length,completeRows:complete,droppedRows:rows.length-complete,missingByMeasure};
}

export async function buildDataset(measures,config,onProgress){
  requestStats={networkRequests:0,cacheHits:0,localSnapshots:0};
  if(!measures.length) throw new Error('Escolha pelo menos uma variável.');
  const unsupported=measures.filter(m=>!m.build);
  if(unsupported.length) throw new Error(`A montagem automática ainda não está disponível para: ${unsupported.map(m=>m.label).join(', ')}.`);
  const domains=[...new Set(measures.map(m=>m.domain))];
  const detailedDomains=domains.filter(d=>d!=='br-time');
  const broadcastTime=domains.includes('br-time')&&detailedDomains.length===1&&['company-year','geo-year'].includes(detailedDomains[0])&&config.frequency==='annual';
  if(domains.length!==1&&!broadcastTime) throw new Error('Essas variáveis não possuem uma chave segura em comum. Escolha unidades compatíveis para evitar uma junção incorreta.');
  const connectors=[...new Set(measures.map(m=>m.connector))];
  onProgress?.({stage:'plan',message:'Preparando as consultas'});
  const groups=connectors.map(connector=>({connector,measures:measures.filter(m=>m.connector===connector)}));
  const built=await Promise.all(groups.map(async group=>{
    let rows;
    if(group.connector==='bcb-sgs') rows=await buildBCB(group.measures,config,onProgress);
    else if(group.connector==='comex-totals') rows=await buildComex(group.measures,config,onProgress);
    else if(group.connector==='ibge-aggregate') rows=await buildIBGE(group.measures,config,onProgress);
    else if(group.connector==='cvm-dfp') rows=await buildCVM(group.measures,config,onProgress);
    else throw new Error(`O conector de ${group.measures.map(m=>m.label).join(', ')} ainda não está pronto.`);
    return {...group,rows,domain:group.measures[0].domain};
  }));

  const outputDomain=broadcastTime?detailedDomains[0]:domains[0];
  let rows;
  if(built.length===1) rows=built[0].rows;
  else if(broadcastTime){
    const detailParts=built.filter(x=>x.domain!=='br-time').map(x=>x.rows);
    const timeParts=built.filter(x=>x.domain==='br-time').map(x=>x.rows);
    rows=broadcastNationalTime(mergeSameDomain(detailParts,outputDomain),mergeSameDomain(timeParts,'br-time'),outputDomain);
  }else rows=mergeSameDomain(built.map(x=>x.rows),outputDomain);

  const quality=auditRows(rows,measures);
  if(config.missing==='complete') rows=completeRows(rows,measures);
  onProgress?.({stage:'done',message:'Base pronta',rows:rows.length});
  return {rows,domain:outputDomain,sourceIds:[...new Set(measures.map(m=>m.source))],stats:{...requestStats},quality,builtAt:new Date().toISOString()};
}

export { parseDelimitedLine, parseNumber, aggregateSeries, flattenIbgeResponse, deriveCvm, mergeSameDomain, broadcastNationalTime };
