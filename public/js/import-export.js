$("#quickExport").onclick=()=>location.href='/api/export.csv';

$('#importCsv').onclick=()=>$('#csvFile').click();

/**
 * RFC4180-aware CSV parser (Batch E).
 * Handles quoted commas, escaped quotes, and embedded newlines.
 */
function parseCsv(text){
  const src=String(text||"");
  if(!src.trim())return[];

  const rows=[];
  let row=[];
  let cur="";
  let q=false;

  for(let i=0;i<src.length;i++){
    const ch=src[i];
    const next=src[i+1];

    if(q){
      if(ch==='"'&&next==='"'){
        cur+='"';
        i++;
        continue;
      }
      if(ch==='"'){
        q=false;
        continue;
      }
      cur+=ch;
      continue;
    }

    if(ch==='"'){
      q=true;
      continue;
    }
    if(ch===','){
      row.push(cur);
      cur="";
      continue;
    }
    if(ch==='\r'){
      continue;
    }
    if(ch==='\n'){
      row.push(cur);
      cur="";
      if(row.some(c=>String(c).trim()!==""))rows.push(row);
      row=[];
      continue;
    }
    cur+=ch;
  }
  row.push(cur);
  if(row.some(c=>String(c).trim()!==""))rows.push(row);

  if(rows.length<2)return[];

  const head=rows[0].map(h=>String(h||"").trim());
  return rows.slice(1).map(cols=>{
    const o={};
    head.forEach((h,i)=>{
      o[h]=cols[i]??"";
    });
    return o;
  }).filter(o=>Object.values(o).some(v=>String(v||"").trim()!==""));
}

$('#csvFile').onchange=async e=>{
  const f=e.target.files[0];
  if(!f)return;

  try{
    const rows=parseCsv(await f.text());
    if(!rows.length){
      toast('No valid CSV rows found.',false);
      e.target.value='';
      return;
    }

    const d=await api('/api/import',{
      method:'POST',
      body:JSON.stringify({rows})
    });

    const parts=[
      `${d.imported||0} imported`,
      `${d.skipped||0} skipped`,
      `${d.duplicates||0} duplicates`
    ];
    if(d.truncated)parts.push(`${d.truncated} truncated (max rows)`);
    toast(parts.join(' · ')+(d.errors&&d.errors.length?` · ${d.errors.length} error(s) shown`:''),!!d.imported);

    if(typeof trades==='function')trades();
    if(typeof dashboard==='function')dashboard();
  }catch(err){
    toast(err.message||'Import failed',false);
  }

  e.target.value='';
};

$("#exportCsv")&&($("#exportCsv").onclick=
  ()=>location.href='/api/export.csv'
);

function readFile(f){
  return new Promise((r,j)=>{
    const x=new FileReader();
    x.onload=()=>r(x.result);
    x.onerror=j;
    x.readAsText(f);
  });
}
