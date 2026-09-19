/* =========================================================
   PREMIUM THEME
   ========================================================= */

function applyGhostTheme(theme,save=true){
  const next=theme==='light'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);

  if(save){
    try{
      localStorage.setItem('ghosttrader-theme',next);
    }catch(e){}
  }

  const button=$("#themeToggle");

  if(button){
    const dark=next==='dark';
    button.innerHTML=dark?'☀ <span>Light mode</span>':'☾ <span>Dark mode</span>';
    button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    button.setAttribute('title',dark?'Switch to light mode':'Switch to dark mode');
  }

  updateMarketChartTheme(next);
}

function updateMarketChartTheme(theme){
  if(!marketChartInstance||typeof marketChartInstance.applyOptions!=='function')return;

  const dark=theme==='dark';

  marketChartInstance.applyOptions({
    layout:{
      background:{type:'solid',color:dark?'#101722':'#ffffff'},
      textColor:dark?'#edf3fb':'#172033'
    },
    grid:{
      vertLines:{color:dark?'#202b3a':'#edf0f4'},
      horzLines:{color:dark?'#202b3a':'#edf0f4'}
    },
    rightPriceScale:{borderColor:dark?'#2a3748':'#dfe4ea'},
    timeScale:{borderColor:dark?'#2a3748':'#dfe4ea'}
  });
}

function initGhostTheme(){
  let theme='dark';

  try{
    const saved=localStorage.getItem('ghosttrader-theme');
    if(saved==='light'||saved==='dark')theme=saved;
  }catch(e){}

  applyGhostTheme(theme,false);

  const button=$("#themeToggle");

  if(button&&!button.dataset.bound){
    button.dataset.bound='1';

    button.onclick=()=>{
      const current=document.documentElement.getAttribute('data-theme')||'dark';
      applyGhostTheme(current==='dark'?'light':'dark');
    };
  }
}

initGhostTheme();
