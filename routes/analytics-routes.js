const express=require("express");

function createAnalyticsRouter({db,auth}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{
    const tz=String(req.query.tz||"UTC");
    const account=String(req.query.account||"").trim();
    const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||""))?String(req.query.from):"";
    const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||""))?String(req.query.to):"";
    /*
     * Batch 2 fix: from/to used to be compared against trade_date
     * as plain dates with no timezone conversion at all, while the
     * byDay breakdown further down already converted trade_date to
     * the caller's local date via timezone($tz,trade_date)::date.
     * That mismatch meant a trade near midnight UTC could be
     * counted in a different day locally than the from/to range
     * put it in - an off-by-one-day bug, worse the further the
     * user's timezone sits from UTC. tz is now bound once as $2 (a
     * real query parameter, not string-interpolated) and every
     * date comparison - both here and in the byDay query below -
     * uses the same timezone($2,trade_date)::date conversion, so
     * "today" means the same calendar day everywhere in this
     * response.
     */
    const v=[req.user.id,tz],w=["user_id=$1"];
    if(account){v.push(account);w.push(`account=$${v.length}`)}
    if(from){v.push(from);w.push(`timezone($2,trade_date)::date >= $${v.length}::date`)}
    if(to){v.push(to);w.push(`timezone($2,trade_date)::date <= $${v.length}::date`)}
    const where=w.join(" AND ");
    const baseParams=[...v];
    const summary=await db(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE profit_loss>0)::int wins,COUNT(*) FILTER(WHERE profit_loss<0)::int losses,COALESCE(SUM(profit_loss),0)::numeric pnl,COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric gp,ABS(COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss<0),0))::numeric gl,COALESCE(AVG(actual_r),0)::numeric avgr,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric aw,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss<0),0)::numeric al,COALESCE(AVG(risk_percent),0)::numeric ar FROM trades WHERE ${where}` ,baseParams);
    const s=summary.rows[0],t=Number(s.total),wins=Number(s.wins),losses=Number(s.losses),gl=Number(s.gl),gp=Number(s.gp),al=Math.abs(Number(s.al)),aw=Number(s.aw),exp=t?wins/t*aw-losses/t*al:0;
    /*
     * Batch 2 fix: a trader with real profit and zero losing trades
     * has a mathematically infinite profit factor (gl=0, gp>0).
     * The old code sent that as the JS value Infinity, but
     * res.json() runs it through JSON.stringify, which silently
     * turns Infinity into the JSON literal null - indistinguishable
     * on the wire from "no data". The dashboard's existing display
     * logic (Number.isFinite(...) ? ... : '∞') was written assuming
     * it would see Infinity, so it never actually fired: a perfect
     * win record rendered as "0.00", the worst possible number for
     * the best possible outcome. profitFactorInfinite now carries
     * that case explicitly so the frontend can render it correctly
     * instead of guessing from a lossy number.
     */
    const profitFactorInfinite=gl===0&&gp>0;
    const profitFactor=gl?gp/gl:0;
    const balanceQuery=account?await db("SELECT COALESCE(starting_balance,0)::numeric starting_balance FROM accounts WHERE user_id=$1 AND name=$2",[req.user.id,account]):await db("SELECT COALESCE(SUM(starting_balance),0)::numeric starting_balance FROM accounts WHERE user_id=$1",[req.user.id]);
    const startingBalance=Number(balanceQuery.rows[0]?.starting_balance||0);
    const make=(sql,extra=[])=>db(sql,[...baseParams,...extra]);
    const [sym,strat,sess,dir,days,curve]=await Promise.all([
      make(`SELECT symbol,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`),
      make(`SELECT COALESCE(strategy,'Unspecified') strategy,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY strategy ORDER BY pnl DESC`),
      make(`SELECT COALESCE(session,'Unspecified') session,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY session ORDER BY pnl DESC`),
      make(`SELECT direction,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY direction ORDER BY direction`),
      make(`SELECT timezone($2,trade_date)::date AS day,COALESCE(SUM(profit_loss),0)::numeric AS pnl,COUNT(*)::int AS trades FROM trades WHERE ${where} GROUP BY timezone($2,trade_date)::date ORDER BY day`),
      make(`SELECT profit_loss,trade_date FROM trades WHERE ${where} ORDER BY trade_date,id`)
    ]);
    let eq=0,peak=0,dd=0,ws=0,ls=0,bw=0,bl=0;
    curve.rows.forEach(x=>{const p=Number(x.profit_loss);eq+=p;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(p>0){ws++;ls=0;bw=Math.max(bw,ws)}else if(p<0){ls++;ws=0;bl=Math.max(bl,ls)}});
    res.json({summary:{total:t,wins,losses,pnl:Number(s.pnl),startingBalance,currentEquity:startingBalance+Number(s.pnl),winRate:t?wins/t*100:0,profitFactor,profitFactorInfinite,avgWin:aw,avgLoss:al,avgR:Number(s.avgr),avgRisk:Number(s.ar),expectancy:exp,maxDrawdown:Math.abs(dd),bestWinStreak:bw,bestLossStreak:bl},bySymbol:sym.rows,byStrategy:strat.rows,bySession:sess.rows,byDirection:dir.rows,byDay:days.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Analytics failed."})}});

  return router;
}

module.exports={createAnalyticsRouter};
