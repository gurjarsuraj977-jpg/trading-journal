const $=x=>document.querySelector(x),$$=x=>[...document.querySelectorAll(x)];
const M=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(n||0));
const C=n=>Number(n||0)>=0?"positive":"negative";
const E=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const TZ=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";

/*
 * Batch 2 fix: this used to build from/to with toISOString(),
 * which always renders in UTC. A trader anywhere east of UTC late
 * in their day (or west of it just after midnight) would get a
 * "to" date that's a day ahead or behind their actual local date,
 * silently dropping or including trades near the boundary and
 * disagreeing with the timezone-aware day bucketing the backend
 * already does elsewhere. Using the Date object's local getters
 * instead keeps this filter's calendar day the same one the
 * browser (and the tz sent alongside it) considers "today".
 */
function localDateStr(d){
  return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateRange(){
  const now=new Date();

  if(state.range==='all')
    return{};

  const from=new Date(now);

  if(state.range==='month')
    from.setDate(1);
  else if(state.range==='3m')
    from.setMonth(from.getMonth()-2,1);
  else if(state.range==='6m')
    from.setMonth(from.getMonth()-5,1);
  else
    from.setFullYear(from.getFullYear()-1);

  return{
    from:localDateStr(from),
    to:localDateStr(now)
  };
}

function query(extra={}){
  const q=new URLSearchParams({
    tz:TZ(),
    ...(dateRange()),
    ...(state.account?{account:state.account}:{}),
    ...extra
  });

  return q;
}

function st(label,value,sub='',cls=''){
  return `<div class="stat-card"><small>${E(label)}${sub?`<i>${E(sub)}</i>`:''}</small><b class="${cls}">${E(value)}</b></div>`;
}

function formatDay(v){
  const d=new Date(
    String(v).length===10?
      v+'T12:00:00':
      v
  );

  return Number.isNaN(d.getTime())?
    '':
    d.toLocaleDateString(
      undefined,
      {
        month:'short',
        day:'numeric'
      }
    );
}
