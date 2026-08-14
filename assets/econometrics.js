const esc=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const finite=value=>value!==null&&value!==''&&Number.isFinite(Number(value));
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;

export function numericModelColumns(rows){
  if(!rows.length) return [];
  const columns=[...new Set(rows.slice(0,2000).flatMap(row=>Object.keys(row)))];
  return columns.filter(column=>{
    if(/^(ano|year|mes|month|period|periodo|data|date|id|codigo|cd_|cnpj)/i.test(column)) return false;
    const values=rows.slice(0,2000).map(row=>row[column]).filter(value=>value!==null&&value!==undefined&&value!=='');
    return values.length>=2&&values.filter(finite).length/values.length>=.92;
  });
}

export function entityColumns(rows){
  if(!rows.length) return [];
  const columns=[...new Set(rows.slice(0,2000).flatMap(row=>Object.keys(row)))];
  return columns.filter(column=>{
    const values=rows.slice(0,2000).map(row=>row[column]).filter(value=>value!==null&&value!==undefined&&value!=='');
    const unique=new Set(values.map(String));
    return values.length>=4&&unique.size>=2&&unique.size<values.length&&unique.size<=1000&&!/^(ano|year|mes|month|period|periodo|data|date)$/i.test(column);
  }).sort((a,b)=>Number(!/empresa|companhia|municipio|localidade|nome/i.test(a))-Number(!/empresa|companhia|municipio|localidade|nome/i.test(b)));
}

export function timeColumns(rows){
  if(!rows.length) return [];
  const columns=[...new Set(rows.slice(0,2000).flatMap(row=>Object.keys(row)))];
  return columns.filter(column=>/^(ano|year|mes|month|period|periodo|data|date)$/i.test(column)&&new Set(rows.map(row=>String(row[column]??''))).size>=2);
}

function transpose(matrix){return matrix[0].map((_,column)=>matrix.map(row=>row[column]));}
function multiply(a,b){return a.map(row=>b[0].map((_,column)=>row.reduce((sum,value,index)=>sum+value*b[index][column],0)));}
function matrixVector(matrix,vector){return matrix.map(row=>row.reduce((sum,value,index)=>sum+value*vector[index],0));}
function invert(matrix){
  const n=matrix.length, augmented=matrix.map((row,index)=>[...row,...Array.from({length:n},(_,column)=>Number(index===column))]);
  for(let column=0;column<n;column++){
    let pivot=column;
    for(let row=column+1;row<n;row++) if(Math.abs(augmented[row][column])>Math.abs(augmented[pivot][column])) pivot=row;
    if(Math.abs(augmented[pivot][column])<1e-10) throw new Error('O modelo ficou singular. Remova uma variável redundante ou aumente a amostra.');
    [augmented[column],augmented[pivot]]=[augmented[pivot],augmented[column]];
    const divisor=augmented[column][column];augmented[column]=augmented[column].map(value=>value/divisor);
    for(let row=0;row<n;row++) if(row!==column){const factor=augmented[row][column];augmented[row]=augmented[row].map((value,index)=>value-factor*augmented[column][index]);}
  }
  return augmented.map(row=>row.slice(n));
}

function normalCdf(value){
  const sign=value<0?-1:1,x=Math.abs(value)/Math.sqrt(2),t=1/(1+.3275911*x);
  const erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);
  return .5*(1+sign*erf);
}

function regress(y,x,names,{clusters=null,intercept=true,method='Regressão OLS'}={}){
  const n=y.length,k=x[0]?.length||0;
  if(n<=k+1) throw new Error(`A amostra tem ${n} linhas válidas, mas o modelo precisa de mais observações do que parâmetros.`);
  const xt=transpose(x),bread=invert(multiply(xt,x)),beta=matrixVector(bread,matrixVector(xt,y));
  const residuals=y.map((value,index)=>value-x[index].reduce((sum,item,column)=>sum+item*beta[column],0));
  let meat=Array.from({length:k},()=>Array(k).fill(0)),variance='HC1';
  if(clusters){
    const grouped=new Map();clusters.forEach((cluster,index)=>{const key=String(cluster);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(index);});
    if(grouped.size<2) throw new Error('São necessárias pelo menos duas unidades para calcular erros agrupados.');
    for(const indexes of grouped.values()){
      const score=Array(k).fill(0);for(const index of indexes) for(let column=0;column<k;column++) score[column]+=x[index][column]*residuals[index];
      for(let row=0;row<k;row++) for(let column=0;column<k;column++) meat[row][column]+=score[row]*score[column];
    }
    const groups=grouped.size,correction=(groups/(groups-1))*((n-1)/(n-k));meat=meat.map(row=>row.map(value=>value*correction));variance=`agrupados por unidade (${groups} grupos)`;
  }else{
    for(let index=0;index<n;index++) for(let row=0;row<k;row++) for(let column=0;column<k;column++) meat[row][column]+=residuals[index]**2*x[index][row]*x[index][column];
    const correction=n/(n-k);meat=meat.map(row=>row.map(value=>value*correction));
  }
  const covariance=multiply(multiply(bread,meat),bread),standardErrors=covariance.map((row,index)=>Math.sqrt(Math.max(0,row[index])));
  const coefficients=beta.map((estimate,index)=>{const standardError=standardErrors[index],statistic=standardError?estimate/standardError:0;return {term:names[index],estimate,standardError,statistic,pValue:Math.max(0,Math.min(1,2*(1-normalCdf(Math.abs(statistic))))),low:estimate-1.96*standardError,high:estimate+1.96*standardError};});
  const yMean=mean(y),sse=residuals.reduce((sum,value)=>sum+value**2,0),sst=y.reduce((sum,value)=>sum+(value-yMean)**2,0),r2=sst?(sse<=1e-12?1:1-sse/sst):0;
  return {method,n,k,coefficients,r2,adjustedR2:1-(1-r2)*(n-(intercept?1:0))/(n-k),rmse:Math.sqrt(sse/n),variance};
}

function prepared(rows,columns){return rows.filter(row=>columns.every(column=>finite(row[column]))).map(row=>({row,values:columns.map(column=>Number(row[column]))}));}

export function fitOLS(rows,{outcome,regressors}){
  if(!outcome||!regressors?.length) throw new Error('Escolha uma variável de resultado e ao menos um regressor.');
  const sample=prepared(rows,[outcome,...regressors]);
  return regress(sample.map(item=>item.values[0]),sample.map(item=>[1,...item.values.slice(1)]),['Intercepto',...regressors],{method:'Regressão OLS'});
}

function demean(values,groups){
  const sums=new Map(),counts=new Map();
  values.forEach((value,index)=>{const key=String(groups[index]);sums.set(key,(sums.get(key)||0)+value);counts.set(key,(counts.get(key)||0)+1);});
  return values.map((value,index)=>value-sums.get(String(groups[index]))/counts.get(String(groups[index])));
}

function residualize(values,entities,times){
  let result=[...values];
  for(let iteration=0;iteration<(times?24:1);iteration++){result=demean(result,entities);if(times)result=demean(result,times);}
  return result;
}

export function fitFixedEffects(rows,{outcome,regressors,entity,time}){
  if(!entity) throw new Error('Escolha a coluna que identifica cada unidade do painel.');
  if(!regressors?.length) throw new Error('Escolha ao menos um regressor.');
  const numeric=[outcome,...regressors],required=[...numeric,entity,...(time?[time]:[])];
  const sample=rows.filter(row=>required.every(column=>row[column]!==null&&row[column]!==undefined&&row[column]!==''&&(numeric.includes(column)?finite(row[column]):true)));
  const entities=sample.map(row=>row[entity]),times=time?sample.map(row=>row[time]):null;
  const y=residualize(sample.map(row=>Number(row[outcome])),entities,times);
  const columns=regressors.map(column=>residualize(sample.map(row=>Number(row[column])),entities,times));
  const x=sample.map((_,index)=>columns.map(column=>column[index]));
  return regress(y,x,regressors,{clusters:entities,intercept:false,method:time?'Efeitos fixos de unidade e tempo':'Efeitos fixos de unidade'});
}

function sortedValues(rows,column){
  return [...new Set(rows.map(row=>row[column]).filter(value=>value!==null&&value!==undefined&&value!=='').map(String))].sort((a,b)=>{
    const na=Number(a),nb=Number(b);return Number.isFinite(na)&&Number.isFinite(nb)?na-nb:a.localeCompare(b,'pt-BR');
  });
}

function causalSample(rows,{outcome,controls=[],entity,time}){
  const numeric=[outcome,...controls];
  return rows.filter(row=>numeric.every(column=>finite(row[column]))&&row[entity]!==null&&row[entity]!==undefined&&row[time]!==null&&row[time]!==undefined);
}

export function fitDID(rows,{outcome,controls=[],entity,time,treatedValue,intervention}){
  const sample=causalSample(rows,{outcome,controls,entity,time}),order=sortedValues(sample,time),cutoff=order.indexOf(String(intervention));
  if(cutoff<=0) throw new Error('Escolha uma intervenção depois do primeiro período da base.');
  const y=[],x=[],clusters=[];
  for(const row of sample){
    const treated=Number(String(row[entity])===String(treatedValue)),post=Number(order.indexOf(String(row[time]))>=cutoff);
    y.push(Number(row[outcome]));x.push([1,treated,post,treated*post,...controls.map(column=>Number(row[column]))]);clusters.push(row[entity]);
  }
  const result=regress(y,x,['Intercepto','Tratado','Pós','DID: Tratado × Pós',...controls],{clusters,method:'Diferenças-em-diferenças'});
  result.focusTerm='DID: Tratado × Pós';return result;
}

export function fitDDD(rows,{outcome,controls=[],entity,time,treatedValue,intervention,groupColumn,groupThreshold}){
  if(!groupColumn) throw new Error('Escolha a variável que define o terceiro grupo.');
  const sample=causalSample(rows,{outcome,controls:[...controls,groupColumn],entity,time}),order=sortedValues(sample,time),cutoff=order.indexOf(String(intervention));
  if(cutoff<=0) throw new Error('Escolha uma intervenção depois do primeiro período da base.');
  const values=sample.map(row=>Number(row[groupColumn])).sort((a,b)=>a-b),threshold=Number.isFinite(Number(groupThreshold))?Number(groupThreshold):values[Math.floor(values.length/2)];
  const y=[],x=[],clusters=[];
  for(const row of sample){
    const treated=Number(String(row[entity])===String(treatedValue)),post=Number(order.indexOf(String(row[time]))>=cutoff),group=Number(Number(row[groupColumn])>=threshold);
    y.push(Number(row[outcome]));x.push([1,treated,post,group,treated*post,treated*group,post*group,treated*post*group,...controls.map(column=>Number(row[column]))]);clusters.push(row[entity]);
  }
  const result=regress(y,x,['Intercepto','Tratado','Pós','Grupo alto','Tratado × Pós','Tratado × Grupo','Pós × Grupo','DDD: Tratado × Pós × Grupo',...controls],{clusters,method:'Diferenças triplas'});
  result.focusTerm='DDD: Tratado × Pós × Grupo';result.groupThreshold=threshold;return result;
}

const rName=name=>`\`${String(name).replace(/`/g,'')}\``;
const pyName=name=>`Q(${JSON.stringify(String(name))})`;

export function generateModelScript(language,config){
  const {method,outcome,regressors=[],entity,time,treatedValue,intervention,groupColumn,groupThreshold}=config;
  if(language==='r'){
    const rhs=regressors.length?regressors.map(rName).join(' + '):'1';
    const setup=`# Gerado pelo RotaDados Brasil\n# Coloque este script ao lado de rotadados.csv\ndf <- read.csv2("rotadados.csv", check.names = FALSE)\n`;
    if(method==='ols') return `${setup}\nmodelo <- lm(${rName(outcome)} ~ ${rhs}, data = df)\n# Instale uma vez: install.packages(c("sandwich", "lmtest"))\nlmtest::coeftest(modelo, vcov. = sandwich::vcovHC(modelo, type = "HC1"))\n`;
    if(method==='fe') return `${setup}\n# Instale uma vez: install.packages("fixest")\nmodelo <- fixest::feols(${rName(outcome)} ~ ${rhs} | ${rName(entity)} + ${rName(time)}, data = df, vcov = ~${rName(entity)})\nsummary(modelo)\n`;
    const common=`${setup}\ndf$tratado <- as.integer(as.character(df[[${JSON.stringify(entity)}]]) == ${JSON.stringify(String(treatedValue))})\ndf$pos <- as.integer(as.character(df[[${JSON.stringify(time)}]]) >= ${JSON.stringify(String(intervention))})\n`;
    if(method==='did') return `${common}\n# Instale uma vez: install.packages("fixest")\nmodelo <- fixest::feols(${rName(outcome)} ~ tratado * pos${regressors.length?' + '+rhs:''}, data = df, vcov = ~${rName(entity)})\nsummary(modelo)\n`;
    return `${common}df$grupo_alto <- as.integer(df[[${JSON.stringify(groupColumn)}]] >= ${Number(groupThreshold)})\n\n# Instale uma vez: install.packages("fixest")\nmodelo <- fixest::feols(${rName(outcome)} ~ tratado * pos * grupo_alto${regressors.length?' + '+rhs:''}, data = df, vcov = ~${rName(entity)})\nsummary(modelo)\n`;
  }
  const rhs=regressors.length?regressors.map(pyName).join(' + '):'1';
  const setup=`# Gerado pelo RotaDados Brasil\n# pip install pandas statsmodels\nimport pandas as pd\nimport statsmodels.formula.api as smf\n\ndf = pd.read_csv("rotadados.csv", sep=";")\n`;
  if(method==='ols') return `${setup}\nmodelo = smf.ols('${pyName(outcome)} ~ ${rhs}', data=df).fit(cov_type="HC1")\nprint(modelo.summary())\n`;
  if(method==='fe') return `${setup}\nmodelo = smf.ols('${pyName(outcome)} ~ ${rhs} + C(${pyName(entity)}) + C(${pyName(time)})', data=df).fit(cov_type="cluster", cov_kwds={"groups": df[${JSON.stringify(entity)}]})\nprint(modelo.summary())\n`;
  const common=`${setup}\ndf["tratado"] = (df[${JSON.stringify(entity)}].astype(str) == ${JSON.stringify(String(treatedValue))}).astype(int)\ndf["pos"] = (df[${JSON.stringify(time)}].astype(str) >= ${JSON.stringify(String(intervention))}).astype(int)\n`;
  if(method==='did') return `${common}\nmodelo = smf.ols('${pyName(outcome)} ~ tratado * pos${regressors.length?' + '+rhs:''}', data=df).fit(cov_type="cluster", cov_kwds={"groups": df[${JSON.stringify(entity)}]})\nprint(modelo.summary())\n`;
  return `${common}df["grupo_alto"] = (df[${JSON.stringify(groupColumn)}] >= ${Number(groupThreshold)}).astype(int)\n\nmodelo = smf.ols('${pyName(outcome)} ~ tratado * pos * grupo_alto${regressors.length?' + '+rhs:''}', data=df).fit(cov_type="cluster", cov_kwds={"groups": df[${JSON.stringify(entity)}]})\nprint(modelo.summary())\n`;
}

function downloadText(text,filename){
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
}

const format=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:5,minimumFractionDigits:0});
const pFormat=value=>value<.001?'&lt; 0,001':format(value);

function resultHtml(result){
  const focus=result.focusTerm?result.coefficients.find(item=>item.term===result.focusTerm):result.coefficients.find(item=>item.term!=='Intercepto');
  return `<div class="model-result"><div class="model-result-head"><div><small>Modelo estimado</small><h5>${esc(result.method)}</h5><p>${result.n} observações · R² ${format(result.r2)} · erros ${esc(result.variance)}</p></div>${focus?`<div class="focus-estimate"><span>efeito principal</span><strong>${format(focus.estimate)}</strong><small>IC 95% ${format(focus.low)} a ${format(focus.high)}</small></div>`:''}</div><div class="model-table-wrap"><table><thead><tr><th>Termo</th><th>Coeficiente</th><th>Erro-padrão</th><th>p-valor</th><th>IC 95%</th></tr></thead><tbody>${result.coefficients.map(item=>`<tr><td>${esc(item.term)}</td><td>${format(item.estimate)}</td><td>${format(item.standardError)}</td><td>${pFormat(item.pValue)}</td><td>${format(item.low)} a ${format(item.high)}</td></tr>`).join('')}</tbody></table></div><p class="model-caution">Leia coeficiente, incerteza e hipótese de identificação em conjunto. Um p-valor isolado não transforma associação em causalidade.</p></div>`;
}

export function mountEconometricsLab(host,rows,{domain}={}){
  if(!host) return;
  const numeric=numericModelColumns(rows),entities=entityColumns(rows),times=timeColumns(rows);
  if(numeric.length<2){
    host.innerHTML='<section class="model-lab compact"><span>Modelagem</span><h4>Adicione pelo menos duas variáveis numéricas.</h4><p>Uma variável será o resultado e a outra entrará como regressor.</p></section>';return;
  }
  const panel=entities.length&&times.length,defaultMethod=domain==='company-year'&&panel?'fe':'ols';
  host.innerHTML=`<section class="model-lab" data-testid="econometrics-lab"><div class="model-lab-head"><div><span>Modelagem econométrica</span><h4>Estime o modelo agora.</h4><p>Escolha o resultado, os regressores e o método. O resultado completo aparece abaixo.</p></div><label>Método<select id="modelMethod"><option value="ols">Regressão OLS</option><option value="fe" ${panel?'':'disabled'}>Efeitos fixos</option><option value="did" ${panel?'':'disabled'}>Diferenças-em-diferenças</option><option value="ddd" ${panel&&numeric.length>=3?'':'disabled'}>Diferenças triplas</option></select></label></div><div id="modelConfig"></div><div id="modelMessage"></div><div id="modelOutput"></div></section>`;
  const methodSelect=host.querySelector('#modelMethod');methodSelect.value=defaultMethod;
  const options=values=>values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  const refreshTreatmentOptions=()=>{
    const entity=host.querySelector('#modelEntity')?.value,time=host.querySelector('#modelTime')?.value;
    const treated=host.querySelector('#modelTreated'),intervention=host.querySelector('#modelIntervention');
    if(treated&&entity) treated.innerHTML=options(sortedValues(rows,entity));
    if(intervention&&time){const periods=sortedValues(rows,time),middle=periods[Math.max(1,Math.floor(periods.length/2))]||'';intervention.innerHTML=periods.map(value=>`<option value="${esc(value)}" ${value===middle?'selected':''}>${esc(value)}</option>`).join('');}
  };
  const renderConfig=()=>{
    const method=methodSelect.value,outcome=numeric[0],regressors=numeric.filter(column=>column!==outcome);
    const entity=entities[0],time=times[0],units=entity?sortedValues(rows,entity):[],periods=time?sortedValues(rows,time):[],intervention=periods[Math.max(1,Math.floor(periods.length/2))]||'';
    host.querySelector('#modelConfig').innerHTML=`<div class="model-fields"><label><span>Resultado (Y)</span><select id="modelOutcome">${options(numeric)}</select></label>${method!=='ols'?`<label><span>Unidade do painel</span><select id="modelEntity">${options(entities)}</select></label><label><span>Tempo</span><select id="modelTime">${options(times)}</select></label>`:''}${['did','ddd'].includes(method)?`<label><span>Unidade tratada</span><select id="modelTreated">${options(units)}</select></label><label><span>Intervenção a partir de</span><select id="modelIntervention">${periods.map(value=>`<option value="${esc(value)}" ${value===intervention?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`:''}${method==='ddd'?`<label><span>Terceiro grupo (corte na média)</span><select id="modelGroup">${options(regressors)}</select></label>`:''}</div><fieldset class="regressor-list"><legend>${['did','ddd'].includes(method)?'Controles adicionais (opcional)':'Regressores (X)'}</legend>${regressors.map((column,index)=>`<label><input type="checkbox" value="${esc(column)}" ${index<Math.min(3,regressors.length)&&method!=='ddd'?'checked':''}><span>${esc(column)}</span></label>`).join('')}</fieldset><div class="model-action"><p>${method==='ols'?'Associação ajustada com erros robustos HC1.':method==='fe'?'Comparação dentro da mesma unidade, com efeitos de tempo e erros agrupados.':method==='did'?'Efeito Tratado × Pós; valide tendências paralelas antes de interpretar causalmente.':'Efeito Tratado × Pós × Grupo; use apenas com uma terceira comparação defensável.'}</p><button id="runModel" type="button">Estimar modelo <b>→</b></button></div>`;
    host.querySelector('#modelEntity')?.addEventListener('change',refreshTreatmentOptions);
    host.querySelector('#modelTime')?.addEventListener('change',refreshTreatmentOptions);
    host.querySelector('#runModel').addEventListener('click',runModel);
  };
  const runModel=()=>{
    const method=methodSelect.value,get=id=>host.querySelector(id)?.value,outcome=get('#modelOutcome');
    const checked=[...host.querySelectorAll('.regressor-list input:checked')].map(input=>input.value).filter(column=>column!==outcome);
    const config={method,outcome,regressors:checked,controls:checked,entity:get('#modelEntity'),time:get('#modelTime'),treatedValue:get('#modelTreated'),intervention:get('#modelIntervention'),groupColumn:get('#modelGroup')};
    if(method==='ddd'){
      const values=rows.map(row=>Number(row[config.groupColumn])).filter(Number.isFinite);config.groupThreshold=values.length?mean(values):0;
      config.regressors=config.regressors.filter(column=>column!==config.groupColumn);config.controls=[...config.regressors];
    }
    const message=host.querySelector('#modelMessage'),output=host.querySelector('#modelOutput');message.innerHTML='';output.innerHTML='';
    try{
      const result=method==='ols'?fitOLS(rows,config):method==='fe'?fitFixedEffects(rows,config):method==='did'?fitDID(rows,config):fitDDD(rows,config);
      if(method==='ddd') config.groupThreshold=result.groupThreshold;
      output.innerHTML=`${resultHtml(result)}<div class="script-downloads"><div><strong>Exportação opcional</strong><span>Se quiser repetir a análise fora do site, baixe a base em CSV e o script.</span></div><button type="button" data-script="r">Script R <em>.R</em></button><button type="button" data-script="python">Script Python <em>.py</em></button></div>`;
      output.querySelectorAll('[data-script]').forEach(button=>button.addEventListener('click',()=>{const language=button.dataset.script;downloadText(generateModelScript(language,config),language==='r'?'modelo_rotadados.R':'modelo_rotadados.py');}));
    }catch(error){message.innerHTML=`<div class="build-error"><strong>O modelo ainda não pode ser estimado.</strong><span>${esc(error.message)}</span></div>`;}
  };
  methodSelect.addEventListener('change',renderConfig);renderConfig();
}
