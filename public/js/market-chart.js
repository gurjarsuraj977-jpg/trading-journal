/* =========================================================
   V8.3 MARKET CHART
   Real PostgreSQL candle data
   ========================================================= */

let marketChartInstance=null;
let marketCandleSeries=null;
let marketChartResizeObserver=null;
let marketChartLibraryPromise=null;


/* ---------------------------------------------------------
   Load Lightweight Charts
   --------------------------------------------------------- */

function loadMarketChartLibrary(){

  if(window.LightweightCharts){
    return Promise.resolve(window.LightweightCharts);
  }

  if(marketChartLibraryPromise){
    return marketChartLibraryPromise;
  }

  marketChartLibraryPromise=new Promise((resolve,reject)=>{

    const existing=
      document.querySelector(
        'script[data-ghost-market-chart]'
      );

    if(existing){

      existing.addEventListener(
        'load',
        ()=>{

          if(window.LightweightCharts)
            resolve(window.LightweightCharts);
          else
            reject(
              new Error(
                'Market chart library loaded incorrectly.'
              )
            );

        }
      );

      existing.addEventListener(
        'error',
        ()=>reject(
          new Error(
            'Could not load the market chart library.'
          )
        )
      );

      if(window.LightweightCharts){
        resolve(window.LightweightCharts);
      }

      return;
    }

    const script=document.createElement('script');

    script.src=
      'https://unpkg.com/lightweight-charts@5.0.0/dist/lightweight-charts.standalone.production.js';

    script.async=true;

    script.dataset.ghostMarketChart='1';

    script.onload=()=>{

      if(!window.LightweightCharts){

        reject(
          new Error(
            'Market chart library loaded incorrectly.'
          )
        );

        return;
      }

      resolve(window.LightweightCharts);
    };

    script.onerror=()=>{

      reject(
        new Error(
          'Could not load Lightweight Charts. Check your internet connection or CDN access.'
        )
      );

    };

    document.head.appendChild(script);

  });

  return marketChartLibraryPromise;
}


/* ---------------------------------------------------------
   Create chart
   --------------------------------------------------------- */

async function createMarketChart(){

  const container=$("#marketChart");

  if(!container){
    throw new Error(
      'Market chart container was not found.'
    );
  }

  const Charts=
    await loadMarketChartLibrary();

  if(
    marketChartInstance &&
    marketCandleSeries
  ){
    return;
  }

  marketChartInstance=
    Charts.createChart(
      container,
      {
        width:Math.max(
          300,
          container.clientWidth
        ),

        height:520,

        layout:{
          background:{
            type:'solid',
            color:'#ffffff'
          },

          textColor:'#172033'
        },

        grid:{
          vertLines:{
            color:'#edf0f4'
          },

          horzLines:{
            color:'#edf0f4'
          }
        },

        rightPriceScale:{
          borderColor:'#dfe4ea'
        },

        timeScale:{
          borderColor:'#dfe4ea',
          timeVisible:true,
          secondsVisible:false
        },

        crosshair:{
          mode:Charts.CrosshairMode.Normal
        },

        handleScroll:{
          mouseWheel:true,
          pressedMouseMove:true,
          horzTouchDrag:true,
          vertTouchDrag:true
        },

        handleScale:{
          mouseWheel:true,
          pinch:true,
          axisPressedMouseMove:true
        }
      }
    );

  marketCandleSeries=
    marketChartInstance.addSeries(
      Charts.CandlestickSeries,
      {
        upColor:'#13a36b',
        downColor:'#e0525d',
        borderUpColor:'#13a36b',
        borderDownColor:'#e0525d',
        wickUpColor:'#13a36b',
        wickDownColor:'#e0525d'
      }
    );


  updateMarketChartTheme(
    document.documentElement.getAttribute('data-theme')||'dark'
  );


  /* -------------------------------------------------------
     Responsive resize
     ------------------------------------------------------- */

  if(
    typeof ResizeObserver!=='undefined'
  ){

    if(marketChartResizeObserver){
      marketChartResizeObserver.disconnect();
    }

    marketChartResizeObserver=
      new ResizeObserver(()=>{

        if(
          !marketChartInstance ||
          !container
        ){
          return;
        }

        const width=
          Math.max(
            300,
            container.clientWidth
          );

        marketChartInstance.applyOptions({
          width
        });

      });

    marketChartResizeObserver.observe(
      container
    );

  }else{

    window.addEventListener(
      'resize',
      resizeMarketChart
    );

  }
}


/* ---------------------------------------------------------
   Fallback resize
   --------------------------------------------------------- */

function resizeMarketChart(){

  if(!marketChartInstance){
    return;
  }

  const container=$("#marketChart");

  if(!container){
    return;
  }

  marketChartInstance.applyOptions({
    width:Math.max(
      300,
      container.clientWidth
    )
  });
}


/* ---------------------------------------------------------
   Load real PostgreSQL candles
   --------------------------------------------------------- */

async function loadMarketCandles(){

  const symbol=
    $("#marketSymbol")?.value||
    'XAUUSD';

  const timeframe=
    $("#marketTimeframe")?.value||
    '1h';

  const limit=
    Number(
      $("#marketLimit")?.value||
      200
    );

  const status=
    $("#marketChartStatus");

  const title=
    $("#marketChartTitle");


  if(status){

    status.textContent=
      `Loading ${symbol} ${timeframe} candles...`;

  }


  if(title){

    title.textContent=
      `${symbol} · ${timeframe.toUpperCase()}`;

  }


  /* -------------------------------------------------------
     Create chart engine
     ------------------------------------------------------- */

  await createMarketChart();


  /* -------------------------------------------------------
     Request authenticated market candles
     ------------------------------------------------------- */

  const d=
    await api(
      `/api/market-data/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`
    );


  const seen=new Set();


  const candles=
    (d.candles||[])

      .map(c=>{

        const timestamp=
          new Date(
            c.candle_time
          ).getTime();

        const open=Number(c.open);
        const high=Number(c.high);
        const low=Number(c.low);
        const close=Number(c.close);

        if(
          !Number.isFinite(timestamp)||
          !Number.isFinite(open)||
          !Number.isFinite(high)||
          !Number.isFinite(low)||
          !Number.isFinite(close)
        ){
          return null;
        }

        return{
          time:Math.floor(
            timestamp/1000
          ),

          open,
          high,
          low,
          close
        };

      })

      .filter(Boolean)

      .sort(
        (a,b)=>a.time-b.time
      )

      .filter(c=>{

        if(seen.has(c.time)){
          return false;
        }

        seen.add(c.time);

        return true;

      });


  /* -------------------------------------------------------
     No candles available
     ------------------------------------------------------- */

  if(!candles.length){

    marketCandleSeries.setData([]);

    if(status){

      status.textContent=
        `No market candles available for ${symbol} ${timeframe}.`;

    }

    return;
  }


  /* -------------------------------------------------------
     Render real OHLC candles
     ------------------------------------------------------- */

  marketCandleSeries.setData(
    candles
  );


  marketChartInstance
    .timeScale()
    .fitContent();


  /* -------------------------------------------------------
     Update status
     ------------------------------------------------------- */

  const first=
    new Date(
      candles[0].time*1000
    );

  const last=
    new Date(
      candles[candles.length-1].time*1000
    );


  if(status){

    status.textContent=
      `${candles.length} real candles · `+
      `${first.toLocaleString()} → `+
      `${last.toLocaleString()}`;

  }

}


/* ---------------------------------------------------------
   Market Chart Page
   --------------------------------------------------------- */

async function marketChartLab(){

  const chart=
    $("#marketChart");

  if(!chart){
    return;
  }


  const loadButton=
    $("#loadMarketChart");


  /* -------------------------------------------------------
     Bind Load Chart button once
     ------------------------------------------------------- */

  if(
    loadButton &&
    !loadButton.dataset.bound
  ){

    loadButton.dataset.bound='1';


    loadButton.onclick=async()=>{

      loadButton.disabled=true;

      try{

        await loadMarketCandles();

      }catch(e){

        console.error(
          'Market chart error:',
          e
        );

        const status=
          $("#marketChartStatus");

        if(status){

          status.textContent=
            e.message||
            'Could not load market chart.';

        }

        showError(
          e.message||
          'Could not load market chart.'
        );

      }finally{

        loadButton.disabled=false;

      }

    };

  }


  /* -------------------------------------------------------
     First page load
     ------------------------------------------------------- */

  await loadMarketCandles();

}
