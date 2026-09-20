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


## Admin Control Center (V8)

Server-side administrator panel for managing registered user accounts.

### Features
- Overview stats, user search/filter/pagination
- Approve pending registrations
- Ban / unban (invalidates sessions via `token_version`)
- Role management with last-admin protection
- Secure user deletion with confirmation and audit trail
- Admin activity log (`admin_audit_log`)

### Bootstrap the first administrator
Set the environment variable (Render / hosting panel), then restart:

```
INITIAL_ADMIN_EMAIL=you@example.com
```

There is **no** public “make me admin” endpoint. The matching user is promoted
to `role=admin` and `status=active` on boot or login.

### Access
- Open `/admin.html` while signed in as an active administrator
- Or use the **Admin** link in the journal sidebar (admins only)

### New registrations
New accounts are created with `status=pending` and cannot use journal APIs
until an administrator approves them. Existing users remain `status=active`.

### API (all require auth + admin)
```
GET    /api/admin/stats
GET    /api/admin/users
GET    /api/admin/users/:id
POST   /api/admin/users/:id/approve
POST   /api/admin/users/:id/ban
POST   /api/admin/users/:id/unban
POST   /api/admin/users/:id/role
DELETE /api/admin/users/:id
GET    /api/admin/audit-log
```
