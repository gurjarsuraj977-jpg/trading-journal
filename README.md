# GhostTrader V2

Replace the files in the existing `trading-journal` GitHub repository. Keep the existing Render environment variables. V2 automatically migrates the existing PostgreSQL database and preserves V1 users/trades.

Features: accounts, R-multiples, risk %, setup/reason/emotions/mistakes/confidence, screenshots, calendar, analytics, CSV export.


## V2.3 reliability fixes
- Fixed trade creation SQL parameter mismatch that prevented new trades from saving.
- Added account-name/currency validation and duplicate-account handling.
- Added proper delete error handling.
- Escaped user-entered table/analytics text before rendering.
- Preserved the existing PostgreSQL schema and automatic migration behavior.
