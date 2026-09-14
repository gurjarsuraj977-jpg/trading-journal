# GhostTrader V7.0 — Premium Execution, Simulation & Intelligence

V7 upgrades the V4 foundation without requiring a database reset.

## Included
- Professional TraderWaves-style dashboard
- Existing authentication, accounts, journal, calendar, analytics, insights and reports
- V5: Playbook Builder + weighted checklist, rule score, MFE/MAE, execution lab, missed trades, CSV import
- V6: Execution Replay of recorded trades, historical MFE/MAE strategy simulator, saved simulation scenarios
- V7: Ghost AI Coach with local journal-aware coaching and optional OpenAI Responses API support
- Existing PostgreSQL data is preserved; migrations use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and create new tables only when missing.

## Important accuracy note
Trade Replay replays a recorded execution from entry to exit. It does not fabricate historical candles. The Strategy Simulator uses recorded MFE/MAE to model alternative target/stop outcomes. A true market-data backtester requires an OHLC/tick data provider and is intentionally not faked in this release.

## Deploy
Replace the repository files, commit and push. Render will redeploy. Keep `DATABASE_URL` and `JWT_SECRET` unchanged.

Optional AI:
- Add `OPENAI_API_KEY` to Render environment variables.
- Optional `OPENAI_MODEL` defaults to `gpt-5.6-luna`.
- Without a key, Ghost AI uses deterministic journal analytics locally.

## Validation
Run:
`node --check server.js`
`node --check public/app.js`
