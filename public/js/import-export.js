$("#quickExport").onclick=()=>location.href='/api/export.csv';

$('#importCsv').onclick=()=>$('#csvFile').click();

function parseCsv(text){
  const lines=text.split(/\r?\n/).filter(x=>x.trim());

  if(!lines.length)return[];

  const parse=line=>{
    const out=[];
    let cur='';
    let q=false;

    for(let i=0;i<line.length;i++){
      const ch=line[i];

      if(ch==='"'&&line[i+1]==='"'){
        cur+='"';
        i++;
        continue;
      }

      if(ch==='"'){
        q=!q;
        continue;
      }

      if(ch===','&&!q){
        out.push(cur.trim());
        cur='';
        continue;
      }

      cur+=ch;
    }

    out.push(cur.trim());

    return out;
  };

  const head=parse(lines[0]);

  return lines.slice(1).map(line=>{
    const a=parse(line);
    const o={};

    head.forEach((h,i)=>{
      o[h]=a[i]??'';
    });

    return o;
  }).filter(o=>Object.values(o).some(Boolean));
}

$('#csvFile').onchange=async e=>{
  const f=e.target.files[0];

  if(!f)return;

  try{
    const rows=parseCsv(await f.text());

    const d=await api('/api/import',{
      method:'POST',
      body:JSON.stringify({rows})
    });

    alert(`Imported ${d.imported} of ${d.received} rows.`);

    await loadAccounts();
    await dashboard();

  }catch(err){
    showError(err.message);
  }finally{
    e.target.value='';
  }
};

$("#export")?.addEventListener(
  'click',
  ()=>location.href='/api/export.csv'
);

function fileData(f){
  return new Promise((r,j)=>{
    const x=new FileReader();

    x.onload=()=>r(x.result);
    x.onerror=j;

    x.readAsDataURL(f);
  });
}
