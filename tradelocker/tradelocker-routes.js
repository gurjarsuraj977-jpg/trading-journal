/**
 * TradeLocker Phase 1 Router
 * Wired to GhostTrader V8 auth middleware and single PostgreSQL db helper.
 */

const express = require('express');
const { TradeLockerClient } = require('./tradelocker-client');
const { TradeLockerSessionManager } = require('./tradelocker-auth');

function createTradeLockerRouter({ db, auth }) {
  if (typeof db !== 'function') {
    throw new Error('TradeLockerRouter requires the V8 db(query, params) helper function.');
  }
  if (typeof auth !== 'function') {
    throw new Error('TradeLockerRouter requires the V8 auth middleware function.');
  }

  const router = express.Router();
  const client = new TradeLockerClient();
  const sessions = new TradeLockerSessionManager();

  // Enforce V8 authentication on all TradeLocker routes
  router.use(auth);

  /**
   * GET /api/tradelocker/status
   * Reports connection status for the authenticated user.
   * On process restart, reports 'reconnect_required' if DB metadata exists.
   */
  router.get('/status', async (req, res) => {
    try {
      const userId = req.user.id;
      const { rows } = await db(
        `SELECT environment, server, account_id, acc_num, account_name, currency, status, last_error, last_connected_at 
         FROM tradelocker_connections WHERE user_id = $1`,
        [userId]
      );

      const dbMeta = rows[0] || null;
      const ramSession = sessions.getSession(userId);

      if (!dbMeta) {
        return res.json({
          connected: false,
          status: 'disconnected',
          message: 'No TradeLocker account connected.'
        });
      }

      // RAM session missing after restart -> reconnect_required
      if (!ramSession || !ramSession.accessToken) {
        return res.json({
          connected: false,
          status: 'reconnect_required',
          environment: dbMeta.environment,
          server: dbMeta.server,
          accountId: dbMeta.account_id,
          accNum: dbMeta.acc_num,
          accountName: dbMeta.account_name,
          currency: dbMeta.currency,
          lastConnectedAt: dbMeta.last_connected_at,
          lastError: dbMeta.last_error,
          message: 'Server was restarted. In-memory session expired. Please reconnect.'
        });
      }

      // Active RAM session exists: attempt to fetch state if account is chosen
      let state = null;
      if (ramSession.selectedAccount && ramSession.selectedAccount.id) {
        try {
          state = await client.getAccountState({
            environment: ramSession.environment,
            accessToken: ramSession.accessToken,
            accountId: ramSession.selectedAccount.id,
            accNum: ramSession.selectedAccount.accNum
          });
        } catch (err) {
          // If token expired, attempt refresh
          if (ramSession.refreshToken) {
            try {
              const refreshed = await client.refreshAccessToken({
                environment: ramSession.environment,
                refreshToken: ramSession.refreshToken
              });
              ramSession.accessToken = refreshed.accessToken;
              ramSession.refreshToken = refreshed.refreshToken;
              state = await client.getAccountState({
                environment: ramSession.environment,
                accessToken: ramSession.accessToken,
                accountId: ramSession.selectedAccount.id,
                accNum: ramSession.selectedAccount.accNum
              });
            } catch (refErr) {
              sessions.clearSession(userId);
              return res.json({
                connected: false,
                status: 'reconnect_required',
                environment: dbMeta.environment,
                server: dbMeta.server,
                accountId: dbMeta.account_id,
                lastError: 'Session expired, please reconnect.',
                lastConnectedAt: dbMeta.last_connected_at
              });
            }
          }
        }
      }

      return res.json({
        connected: true,
        status: 'connected',
        environment: ramSession.environment,
        server: ramSession.server,
        accountId: ramSession.selectedAccount ? ramSession.selectedAccount.id : dbMeta.account_id,
        accNum: ramSession.selectedAccount ? ramSession.selectedAccount.accNum : dbMeta.acc_num,
        accountName: ramSession.selectedAccount ? ramSession.selectedAccount.accountName : dbMeta.account_name,
        currency: ramSession.selectedAccount ? ramSession.selectedAccount.currency : dbMeta.currency,
        lastConnectedAt: dbMeta.last_connected_at,
        lastError: null,
        state
      });
    } catch (err) {
      console.error('[TradeLocker Status Error]:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve connection status.' });
    }
  });

  /**
   * POST /api/tradelocker/connect
   * Validates credentials with TradeLocker, normalizes accounts, stores tokens in RAM only.
   */
  router.post('/connect', async (req, res) => {
    const { environment, server, email, password } = req.body || {};
    const userId = req.user.id;

    if (!environment || !['demo', 'live'].includes(environment.toLowerCase())) {
      return res.status(400).json({ error: 'Valid environment ("demo" or "live") is required.' });
    }
    if (!server || typeof server !== 'string' || !server.trim()) {
      return res.status(400).json({ error: 'Server name is required.' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const envClean = environment.toLowerCase().trim();
    const srvClean = server.trim();

    try {
      // 1. Authenticate with TradeLocker
      const authData = await client.authenticate({
        environment: envClean,
        server: srvClean,
        email: email.trim(),
        password
      });

      // 2. Fetch available accounts
      const accounts = await client.getAllAccounts({
        environment: envClean,
        accessToken: authData.accessToken
      });

      if (!accounts || accounts.length === 0) {
        return res.status(400).json({ error: 'TradeLocker login succeeded, but no trading accounts were found.' });
      }

      // Auto-select first account if only one exists
      const initialAccount = accounts.length === 1 ? accounts[0] : null;

      // 3. Save tokens strictly in RAM
      sessions.setSession(userId, {
        environment: envClean,
        server: srvClean,
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
        accounts,
        selectedAccount: initialAccount
      });

      // 4. Record sanitized metadata in PostgreSQL
      await db(
        `INSERT INTO tradelocker_connections (
          user_id, environment, server, account_id, acc_num, account_name, currency, status, last_connected_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          environment = EXCLUDED.environment,
          server = EXCLUDED.server,
          account_id = COALESCE(EXCLUDED.account_id, tradelocker_connections.account_id),
          acc_num = COALESCE(EXCLUDED.acc_num, tradelocker_connections.acc_num),
          account_name = COALESCE(EXCLUDED.account_name, tradelocker_connections.account_name),
          currency = COALESCE(EXCLUDED.currency, tradelocker_connections.currency),
          status = 'connected',
          last_error = NULL,
          last_connected_at = NOW(),
          updated_at = NOW()`,
        [
          userId,
          envClean,
          srvClean,
          initialAccount ? initialAccount.id : null,
          initialAccount ? initialAccount.accNum : null,
          initialAccount ? initialAccount.accountName : null,
          initialAccount ? initialAccount.currency : null
        ]
      );

      // Return sanitized list of accounts (tokens and passwords never returned)
      return res.json({
        success: true,
        connected: true,
        environment: envClean,
        server: srvClean,
        accounts: accounts.map(a => ({
          id: a.id,
          accNum: a.accNum,
          accountName: a.accountName,
          currency: a.currency
        })),
        selectedAccount: initialAccount
      });
    } catch (err) {
      console.error('[TradeLocker Connect Error]:', err.message);
      await db(
        `INSERT INTO tradelocker_connections (user_id, environment, server, status, last_error, updated_at)
         VALUES ($1, $2, $3, 'error', $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           status = 'error',
           last_error = EXCLUDED.last_error,
           updated_at = NOW()`,
        [userId, envClean, srvClean, err.message]
      ).catch(() => {});

      return res.status(401).json({ error: err.message || 'TradeLocker authentication failed.' });
    }
  });

  /**
   * GET /api/tradelocker/accounts
   * Returns accounts list from the active session
   */
  router.get('/accounts', (req, res) => {
    const session = sessions.getSession(req.user.id);
    if (!session || !session.accessToken) {
      return res.status(401).json({ error: 'Reconnect required.', reconnectRequired: true });
    }
    return res.json({
      success: true,
      accounts: session.accounts.map(a => ({
        id: a.id,
        accNum: a.accNum,
        accountName: a.accountName,
        currency: a.currency
      })),
      selectedAccount: session.selectedAccount
    });
  });

  /**
   * POST /api/tradelocker/select-account
   * Validates account selection against the active session's accounts list
   */
  router.post('/select-account', async (req, res) => {
    const userId = req.user.id;
    const { accountId } = req.body || {};

    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required.' });
    }

    const session = sessions.getSession(userId);
    if (!session || !session.accessToken) {
      return res.status(401).json({ error: 'Session expired or invalid. Please reconnect.', reconnectRequired: true });
    }

    // Strict validation: Must match one of the accounts received from TradeLocker
    const targetAccount = session.accounts.find(a => String(a.id) === String(accountId));
    if (!targetAccount) {
      return res.status(403).json({ error: 'Forbidden: Selected account is not associated with this session.' });
    }

    session.selectedAccount = targetAccount;

    // Update metadata in PostgreSQL
    await db(
      `UPDATE tradelocker_connections SET
        account_id = $1,
        acc_num = $2,
        account_name = $3,
        currency = $4,
        status = 'connected',
        updated_at = NOW()
       WHERE user_id = $5`,
      [targetAccount.id, targetAccount.accNum, targetAccount.accountName, targetAccount.currency, userId]
    );

    // Fetch state for confirmed account
    let state = null;
    try {
      state = await client.getAccountState({
        environment: session.environment,
        accessToken: session.accessToken,
        accountId: targetAccount.id,
        accNum: targetAccount.accNum
      });
    } catch (e) {
      console.warn('[TradeLocker State Warning]:', e.message);
    }

    return res.json({
      success: true,
      selectedAccount: targetAccount,
      state
    });
  });

  /**
   * GET /api/tradelocker/state
   * Retrieves current balance and equity for selected account
   */
  router.get('/state', async (req, res) => {
    const userId = req.user.id;
    const session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      return res.status(401).json({ error: 'Reconnect required.', reconnectRequired: true });
    }
    if (!session.selectedAccount || !session.selectedAccount.id) {
      return res.status(400).json({ error: 'No account currently selected. Please select an account first.' });
    }

    try {
      const state = await client.getAccountState({
        environment: session.environment,
        accessToken: session.accessToken,
        accountId: session.selectedAccount.id,
        accNum: session.selectedAccount.accNum
      });

      return res.json({ success: true, state });
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Failed to fetch account state from TradeLocker.' });
    }
  });

  /**
   * POST /api/tradelocker/disconnect
   * Purges RAM session and updates PostgreSQL status to 'disconnected'
   */
  router.post('/disconnect', async (req, res) => {
    const userId = req.user.id;
    sessions.clearSession(userId);

    await db(
      `UPDATE tradelocker_connections SET status = 'disconnected', updated_at = NOW() WHERE user_id = $1`,
      [userId]
    ).catch(() => {});

    return res.json({ success: true, status: 'disconnected', message: 'TradeLocker disconnected.' });
  });

  return router;
}

module.exports = { createTradeLockerRouter };
