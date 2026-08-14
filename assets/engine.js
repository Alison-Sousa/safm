export const normalize = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9%\s.-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STOP = new Set(['como','para','pela','pelo','pelas','pelos','uma','uns','umas','que','dos','das','de','do','da','em','no','na','nos','nas','com','sem','entre','sobre','afeta','afetam','efeito','impacto','impacta','relacao','relacionar','estudar','pesquisar','quero','dados','brasil','brasileiro','brasileiros','brasileira','brasileiras']);

export function tokens(value){
  return normalize(value).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
}

export function levenshtein(a,b){
  a = normalize(a); b = normalize(b);
  if(a === b) return 0;
  if(!a.length) return b.length;
  if(!b.length) return a.length;
  const prev = Array.from({length:b.length+1},(_,i)=>i);
  const cur = new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    cur[0]=i;
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
    }
    for(let j=0;j<=b.length;j++) prev[j]=cur[j];
  }
  return prev[b.length];
}

function jaroWinkler(a,b){
  a=normalize(a); b=normalize(b);
  if(a===b) return 1;
  const la=a.length, lb=b.length; if(!la||!lb) return 0;
  const range=Math.max(0,Math.floor(Math.max(la,lb)/2)-1);
  const ma=new Array(la).fill(false), mb=new Array(lb).fill(false); let matches=0;
  for(let i=0;i<la;i++){
    const from=Math.max(0,i-range), to=Math.min(i+range+1,lb);
    for(let j=from;j<to;j++) if(!mb[j]&&a[i]===b[j]){ma[i]=true;mb[j]=true;matches++;break;}
  }
  if(!matches) return 0;
  let trans=0,j=0;
  for(let i=0;i<la;i++) if(ma[i]){while(!mb[j])j++;if(a[i]!==b[j])trans++;j++;}
  trans/=2;
  const jaro=(matches/la+matches/lb+(matches-trans)/matches)/3;
  let prefix=0; while(prefix<4&&prefix<la&&prefix<lb&&a[prefix]===b[prefix]) prefix++;
  return jaro+prefix*.1*(1-jaro);
}

export function closeWord(a,b){
  a=normalize(a); b=normalize(b);
  if(a===b) return true;
  if(a.length<4 || b.length<4) return false;
  if(a[0]!==b[0] || Math.abs(a.length-b.length)>3) return false;
  const d=levenshtein(a,b), max=Math.max(a.length,b.length);
  const allowance = max <= 5 ? 1 : max <= 9 ? 2 : 3;
  return d <= allowance || (1 - d/max) >= .76 || (max>=6 && jaroWinkler(a,b)>=.88);
}

function phraseScore(query, phrase){
  const q=tokens(query), p=tokens(phrase);
  if(!p.length) return 0;
  const normalizedQuery=` ${normalize(query)} `, normalizedPhrase=normalize(phrase);
  if(normalizedPhrase && normalizedQuery.includes(` ${normalizedPhrase} `)) return 28+p.length*3;
  let hits=0, exact=0, fuzzy=0;
  for(const pt of p){
    const match=q.find(qt=>qt===pt || closeWord(qt,pt));
    if(match){ hits++; if(match===pt) exact++; else fuzzy++; }
  }
  if(hits===p.length) return 8 + exact*5 + fuzzy*3 + p.length*2;
  if(p.length>=3 && hits>=Math.ceil(p.length*.67)) return exact*4+fuzzy*2;
  return 0;
}

function tokenScore(query, list=[]){
  const q=tokens(query), vocabulary=[...new Set(list.flatMap(tokens))]; let score=0;
  for(const qt of q){
    if(vocabulary.some(pt=>qt===pt)) score+=4;
    else if(vocabulary.some(pt=>closeWord(qt,pt))) score+=2;
  }
  return score;
}

function hasConcept(query, words){
  const q=tokens(query);
  return q.some(w=>words.some(x=>w===normalize(x)||closeWord(w,x)));
}

function parseYears(text){
  const n=normalize(text);
  const years=[...n.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(m=>Number(m[1]));
  const current = new Date().getFullYear();
  const openEnded=years.length===1&&/(?:\bdesde\b|a partir de|ate hoje|atualmente|ate o presente)/.test(n);
  return {
    start: years.length ? Math.min(...years) : null,
    end: openEnded ? current : years.length ? Math.max(...years) : null
  };
}

function parseFrequency(text){
  const n=normalize(text);
  if(/mensal|mes a mes|por mes/.test(n)) return 'monthly';
  if(/trimestral|trimestre/.test(n)) return 'quarterly';
  if(/anual|ano a ano|por ano/.test(n)) return 'annual';
  if(/diari|por dia/.test(n)) return 'daily';
  return null;
}

function parseGeo(text){
  const n=normalize(text);
  if(/municip|cidade/.test(n)) return 'municipality';
  if(/estado| estados|\buf\b/.test(n)) return 'state';
  if(/brasil|nacional|pais/.test(n)) return 'brazil';
  return null;
}

function isFemaleMortality(query){
  const q=tokens(query);
  const death=q.some(w=>['mortalidade','obito','obitos','morte','mortes'].some(x=>closeWord(w,x)));
  const female=q.some(w=>['feminina','feminino','mulher','mulheres'].some(x=>closeWord(w,x)));
  return death && female;
}
function isInfantMortality(query){
  const q=tokens(query);
  const death=q.some(w=>['mortalidade','obito','obitos','morte','mortes'].some(x=>closeWord(w,x)));
  const infant=q.some(w=>['infantil','neonatal','bebe','bebes'].some(x=>closeWord(w,x)));
  return death && infant;
}
function isMaternalMortality(query){
  const q=tokens(query);
  const death=q.some(w=>['mortalidade','obito','obitos','morte','mortes'].some(x=>closeWord(w,x)));
  const maternal=q.some(w=>['materna','materno'].some(x=>closeWord(w,x)));
  return death && maternal;
}

export function analyzeQuery(query, ontology){
  const text=String(query||'').trim();
  const n=normalize(text);
  const available=readyDimensions(ontology);
  const dimensions=available.map(dim=>{
    let score=0;
    for(const alias of dim.aliases||[]) score=Math.max(score,phraseScore(n,alias));
    score += tokenScore(n,dim.context||[]);
    return {...dim,score};
  });

  // Contextual boosts that make broad phrases useful without pretending to be an LLM.
  const companyMention=hasConcept(n,['empresa','companhia','firma','negocio']);
  const growthMention=hasConcept(n,['crescimento','crescer','expansao']);
  const financeMention=hasConcept(n,['financas','financeiro','rentabilidade','liquidez','endividamento','receita','lucro']);
  const publicMention=hasConcept(n,['publica','publico','governo','prefeitura','municipio','estado']);
  const sportMention=hasConcept(n,['futebol','esporte','esportivo','campeonato','clube','jogador','partida','gol']);

  for(const d of dimensions){
    if(companyMention && financeMention && d.id==='corporateFinance') d.score += 18;
    if(companyMention && growthMention && d.id==='firmGrowth') d.score += 20;
    if(financeMention && publicMention && d.id==='publicFinance') d.score += 14;
    if(financeMention && !companyMention && !publicMention && !sportMention && ['corporateFinance','publicFinance'].includes(d.id)) d.score += 8;
    if(sportMention && d.id==='sports') d.score += 22;
    if(sportMention && financeMention && d.id==='sports') d.score += 12;
    if(!publicMention && companyMention && d.id==='publicFinance') d.score -= 10;
    if(sportMention && ['labor','publicFinance','corporateFinance'].includes(d.id)) d.score -= 8;
  }

  // Strong mortality disambiguation: never turns women into infant mortality.
  if(isFemaleMortality(n)){
    const h=dimensions.find(d=>d.id==='health'); if(h) h.score+=24;
  }
  if(isInfantMortality(n)){
    const h=dimensions.find(d=>d.id==='health'); if(h) h.score+=24;
  }
  if(isMaternalMortality(n)){
    const h=dimensions.find(d=>d.id==='health'); if(h) h.score+=24;
  }

  let detected=dimensions.filter(d=>d.score>=14).sort((a,b)=>b.score-a.score).slice(0,3);

  // If the phrase is specifically about company finance/growth, keep the interface focused.
  if(companyMention && financeMention && growthMention){
    detected=['corporateFinance','firmGrowth'].map(id=>dimensions.find(d=>d.id===id)).filter(Boolean);
  }

  const directMeasures=[];
  const allowedMeasures=new Set(detected.flatMap(d=>d.measures||[]));
  for(const measure of ontology.measures){
    if(allowedMeasures.size && !allowedMeasures.has(measure.id)) continue;
    let score=0;
    for(const tag of measure.tags||[]) score=Math.max(score,phraseScore(n,tag));
    if(score>=16) directMeasures.push({id:measure.id,score});
  }
  const years=parseYears(n);
  const suggestedDimensions=dimensions.filter(d=>!detected.some(x=>x.id===d.id)&&d.score>=4).sort((a,b)=>b.score-a.score).slice(0,4);
  const vocabulary=[
    ...detected.flatMap(d=>[...(d.aliases||[]),...(d.context||[])]).flatMap(tokens),
    ...directMeasures.flatMap(dm=>(ontology.measures.find(m=>m.id===dm.id)?.tags||[])).flatMap(tokens)
  ];
  const unmatchedTerms=[...new Set(tokens(n).filter(w=>!vocabulary.some(v=>w===v||closeWord(w,v))))].slice(0,6);
  const confidence=detected.length ? Math.min(1,Math.max(...detected.map(d=>d.score))/42) : 0;
  return {
    query:text,
    normalized:n,
    dimensions:detected,
    suggestedDimensions,
    directMeasures:[...new Map(directMeasures.sort((a,b)=>b.score-a.score).map(x=>[x.id,x])).values()].slice(0,4),
    years,
    requestedFrequency:parseFrequency(n),
    requestedGeo:parseGeo(n),
    unmatchedTerms,
    confidence,
    confidenceLevel:confidence>=.72?'high':confidence>=.42?'medium':'low'
  };
}

export function getMeasure(ontology,id){ return ontology.measures.find(m=>m.id===id); }
export function getSource(ontology,id){ return ontology.sources.find(s=>s.id===id); }
export function readyDimensions(ontology){
  const ready=new Set((ontology.measures||[]).filter(m=>m.build&&m.connector).map(m=>m.id));
  const priority=new Map(['corporateFinance','firmGrowth','macro','foreignTrade','municipalEconomy'].map((id,index)=>[id,index]));
  return (ontology.dimensions||[])
    .filter(dim=>(dim.measures||[]).some(id=>ready.has(id)))
    .sort((a,b)=>(priority.get(a.id)??99)-(priority.get(b.id)??99));
}

export function resolvedEndYear(measure){
  const y=new Date().getFullYear();
  if(measure.endYear==='lastFullYear') return y-1;
  if(measure.endYear==='currentYear') return y;
  if(Number.isFinite(Number(measure.endYear))) return Number(measure.endYear);
  return y;
}

export function resolvedStartYear(measure){
  if(measure.connector==='cvm-dfp'){
    return ['revenue_growth','asset_growth'].includes(measure.metric)?2021:2020;
  }
  return Number(measure.startYear)||1900;
}

export function commonConfig(measures, intent){
  if(!measures.length) return null;
  const domains=[...new Set(measures.map(m=>m.domain))];
  const detailedDomains=domains.filter(d=>d!=='br-time');
  const broadcastTime=domains.includes('br-time') && detailedDomains.length===1 && ['company-year','geo-year'].includes(detailedDomains[0]);
  const domain=domains.length===1?domains[0]:(broadcastTime?detailedDomains[0]:null);
  const starts=measures.map(resolvedStartYear);
  const ends=measures.map(resolvedEndYear);
  const start=Math.max(...starts);
  const end=Math.min(...ends);
  const requestedStart=intent?.years?.start;
  const requestedEnd=intent?.years?.end;
  const frequencies=['daily','monthly','quarterly','annual'];
  const commonFreq=frequencies.filter(f=>measures.every(m=>(m.frequencies||[]).includes(f)));
  // Permit safe downsampling to annual when every series can be represented annually.
  if(!commonFreq.includes('annual') && measures.every(m=>m.frequencies?.some(f=>['daily','monthly','quarterly','annual'].includes(f)))) commonFreq.push('annual');
  const defaultWindow=domain==='company-year'?3:5;
  return {
    domain,
    mixedDomain:domains.length>1&&!broadcastTime,
    joinMode:broadcastTime?'broadcast-time':'same-domain',
    start,
    end,
    defaultStart:Math.max(start,requestedStart||Math.max(start,end-defaultWindow)),
    defaultEnd:Math.min(end,requestedEnd||end),
    frequencies:broadcastTime?['annual']:(commonFreq.length?commonFreq:['annual'])
  };
}

export function suggestedControls(ontology, measures){
  if(!measures.length) return [];
  const domain=measures[0].domain;
  const ids=ontology.controlSuggestions?.[domain]||[];
  const selected=new Set(measures.map(m=>m.id));
  return ids.filter(id=>!selected.has(id)).map(id=>getMeasure(ontology,id)).filter(Boolean).slice(0,3);
}
