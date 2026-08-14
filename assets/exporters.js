function csvCell(value){
  if(value===null || value===undefined) return '';
  const s=String(value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

export function rowsToCSV(rows,delimiter=';'){
  if(!rows.length) return '';
  const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const lines=[cols.map(csvCell).join(delimiter)];
  for(const row of rows) lines.push(cols.map(c=>csvCell(row[c])).join(delimiter));
  return '\ufeff'+lines.join('\n');
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export function downloadCSV(rows,filename='rotadados.csv'){
  downloadBlob(new Blob([rowsToCSV(rows)],{type:'text/csv;charset=utf-8'}),filename);
}

let xlsxLoading=null;
async function ensureSheetJS(){
  if(window.XLSX) return window.XLSX;
  if(!xlsxLoading){
    xlsxLoading=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=()=>resolve(window.XLSX); s.onerror=()=>reject(new Error('Não foi possível carregar o módulo de Excel.'));
      document.head.appendChild(s);
    });
  }
  return xlsxLoading;
}

export async function downloadXLSX(rows,filename='rotadados.xlsx'){
  const XLSX=await ensureSheetJS();
  const ws=XLSX.utils.json_to_sheet(rows,{cellDates:true});
  const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  ws['!cols']=cols.map(c=>({wch:Math.min(34,Math.max(11,c.length+2))}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'dados');
  XLSX.writeFile(wb,filename,{compression:true});
}

let duckPromise=null;
async function ensureDuckDB(){
  if(duckPromise) return duckPromise;
  duckPromise=(async()=>{
    const duckdb=await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
    const bundles=duckdb.getJsDelivrBundles();
    const bundle=await duckdb.selectBundle(bundles);
    let worker;
    try{ worker=new Worker(bundle.mainWorker); }
    catch(_){
      const workerUrl=URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`],{type:'text/javascript'}));
      worker=new Worker(workerUrl);
    }
    const logger=new duckdb.ConsoleLogger(duckdb.LogLevel?.WARNING);
    const db=new duckdb.AsyncDuckDB(logger,worker);
    await db.instantiate(bundle.mainModule,bundle.pthreadWorker);
    return {duckdb,db,worker};
  })();
  return duckPromise;
}

export async function downloadParquet(rows,filename='rotadados.parquet'){
  const {db}=await ensureDuckDB();
  const csv=rowsToCSV(rows,',').replace(/^\ufeff/,'');
  const input=`rota_${Date.now()}.csv`, output=`rota_${Date.now()}.parquet`;
  await db.registerFileText(input,csv);
  await db.registerEmptyFileBuffer(output);
  const conn=await db.connect();
  try{
    await conn.query(`COPY (SELECT * FROM read_csv_auto('${input}', HEADER=TRUE, DELIM=',', SAMPLE_SIZE=-1)) TO '${output}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    const buffer=await db.copyFileToBuffer(output);
    downloadBlob(new Blob([buffer],{type:'application/vnd.apache.parquet'}),filename);
  } finally {
    await conn.close();
    try{await db.dropFile(input);}catch(_){ }
    try{await db.dropFile(output);}catch(_){ }
  }
}
