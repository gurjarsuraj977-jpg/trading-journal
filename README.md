# GhostTrader Trading Journal V1

A full-stack trading journal with:
- User registration/login
- PostgreSQL database
- Trade CRUD
- Automatic P&L and R-multiple calculations
- Dashboard statistics
- Equity curve
- Trade history filters
- Responsive dark UI
- Render deployment configuration

## 1. Requirements

- Node.js 20+
- PostgreSQL database

## 2. Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
JWT_SECRET=use-a-long-random-secret
PORT=10000
```

Then:

```bash
npm start
```

Open http://localhost:10000

The server automatically creates the required database tables on startup.

## 3. Render

1. Push this folder to GitHub.
2. Create a PostgreSQL database on your preferred PostgreSQL provider.
3. Create a Render Web Service from the GitHub repository.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add `DATABASE_URL`.
7. Add a strong `JWT_SECRET`.
8. Deploy.

## Notes

V1 stores trade screenshots as URLs only; file uploads are intentionally left for V2.
P&L is calculated from the trade's supplied monetary values when `profitLoss` is provided, otherwise it is calculated from price movement, quantity and contract size. For instruments with broker-specific contract specifications, use the monetary P&L field for exact broker matching.
