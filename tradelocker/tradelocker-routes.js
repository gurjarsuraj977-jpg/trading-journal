/**
 * TradeLocker Phase 1 Router
 * Wired to GhostTrader V8 auth middleware and single PostgreSQL db helper.
 */

const express = require('express');
const { TradeLockerClient } = require('./tradelocker-client');
const { TradeLockerSessionManager } = require('./tradelocker-auth');

function createTradeLockerRouter({ db, auth }) {
  if (typeof db !== 'function') {
    throw new Error(
      'TradeLockerRouter requires the V8 db(query, params) helper function.'
    );
  }

  if (typeof auth !== 'function') {
    throw new Error(
      'TradeLockerRouter requires the V8 auth middleware function.'
    );
  }

  const router = express.Router();
  
const client = new TradeLockerClient();

const sessions =
  new TradeLockerSessionManager({
    db,
    client
  });

  router.use(auth);

  // ------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------
  router.get('/status', async (req, res) => {
    try {
      const userId = req.user.id;

      const { rows } = await db(
        `SELECT environment, server, account_id, acc_num, account_name, currency, status, last_error, last_connected_at
         FROM tradelocker_connections
         WHERE user_id = $1`,
        [userId]
      );

      const dbMeta = rows[0] || null;

      let ramSession = sessions.getSession(userId);

      if (!dbMeta) {
        return res.json({
          connected: false,
          status: 'disconnected',
          message: 'No TradeLocker account connected.'
        });
      }

      // --------------------------------------------------------
      // RESTORE SESSION AFTER SERVER RESTART
      // --------------------------------------------------------
      if (!ramSession || !ramSession.accessToken) {
        const restoredSession =
          await sessions.restoreSession(userId);

        if (!restoredSession || !restoredSession.accessToken) {
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
            message:
              'TradeLocker session could not be restored. Please reconnect.'
          });
        }

        // IMPORTANT:
        // Use the newly restored session below.
        ramSession = restoredSession;
      }

      let state = null;

      if (
        ramSession.selectedAccount &&
        ramSession.selectedAccount.id &&
        ramSession.selectedAccount.accNum !== null &&
        ramSession.selectedAccount.accNum !== undefined &&
        !isNaN(Number(ramSession.selectedAccount.accNum))
      ) {
        try {
          state = await client.getAccountState({
            environment: ramSession.environment,
            accessToken: ramSession.accessToken,
            accountId: ramSession.selectedAccount.id,
            accNum: ramSession.selectedAccount.accNum
          });
        } catch (err) {
          if (ramSession.refreshToken) {
            try {
              const refreshed =
                await client.refreshAccessToken({
                  environment: ramSession.environment,
                  refreshToken: ramSession.refreshToken
                });

              ramSession.accessToken =
                refreshed.accessToken;

              ramSession.refreshToken =
                refreshed.refreshToken ||
                ramSession.refreshToken;

              state = await client.getAccountState({
                environment: ramSession.environment,
                accessToken: ramSession.accessToken,
                accountId: ramSession.selectedAccount.id,
                accNum: ramSession.selectedAccount.accNum
              });
            } catch (refErr) {
              await sessions.clearSession(userId);

              return res.json({
                connected: false,
                status: 'reconnect_required',
                environment: dbMeta.environment,
                server: dbMeta.server,
                accountId: dbMeta.account_id,
                accNum: dbMeta.acc_num,
                accountName: dbMeta.account_name,
                currency: dbMeta.currency,
                lastError:
                  'Session expired, please reconnect.',
                lastConnectedAt:
                  dbMeta.last_connected_at
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
        accountId: ramSession.selectedAccount
          ? ramSession.selectedAccount.id
          : dbMeta.account_id,
        accNum: ramSession.selectedAccount
          ? ramSession.selectedAccount.accNum
          : dbMeta.acc_num,
        accountName: ramSession.selectedAccount
          ? ramSession.selectedAccount.accountName
          : dbMeta.account_name,
        currency: ramSession.selectedAccount
          ? ramSession.selectedAccount.currency
          : dbMeta.currency,
        lastConnectedAt:
          dbMeta.last_connected_at,
        lastError: null,
        state
      });
    } catch (err) {
      console.error(
        '[TradeLocker Status Error]:',
        err.message
      );

      return res.status(500).json({
        error: 'Failed to retrieve connection status.'
      });
    }
  });

  // ------------------------------------------------------------
  // CONNECT
  // ------------------------------------------------------------
  router.post('/connect', async (req, res) => {
    const {
      environment,
      server,
      email,
      password
    } = req.body || {};

    const userId = req.user.id;

    if (
      !environment ||
      !['demo', 'live'].includes(environment.toLowerCase())
    ) {
      return res.status(400).json({
        error: 'Valid environment ("demo" or "live") is required.'
      });
    }

    if (
      !server ||
      typeof server !== 'string' ||
      !server.trim()
    ) {
      return res.status(400).json({
        error: 'Server name is required.'
      });
    }

    if (
      !email ||
      typeof email !== 'string' ||
      !email.trim()
    ) {
      return res.status(400).json({
        error: 'Email is required.'
      });
    }

    if (
      !password ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        error: 'Password is required.'
      });
    }

    const envClean = environment.toLowerCase().trim();
    const srvClean = server.trim();

    try {
      const authData = await client.authenticate({
        environment: envClean,
        server: srvClean,
        email: email.trim(),
        password
      });

      const accounts = await client.getAllAccounts({
        environment: envClean,
        accessToken: authData.accessToken
      });

      if (!accounts || accounts.length === 0) {
        return res.status(400).json({
          error:
            'TradeLocker login succeeded, but no trading accounts were found.'
        });
      }

      const initialAccount =
        accounts.length === 1
          ? accounts[0]
          : null;

await sessions.setSession(userId, {
  environment: envClean,
  server: srvClean,
  accessToken: authData.accessToken,
  refreshToken: authData.refreshToken,
  accounts,
  selectedAccount: initialAccount,
  email: email.trim()
});

      await db(
        `INSERT INTO tradelocker_connections (
          user_id,
          environment,
          server,
          account_id,
          acc_num,
          account_name,
          currency,
          status,
          last_connected_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'connected',
          NOW(),
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          environment = EXCLUDED.environment,
          server = EXCLUDED.server,
          account_id = COALESCE(
            EXCLUDED.account_id,
            tradelocker_connections.account_id
          ),
          acc_num = COALESCE(
            EXCLUDED.acc_num,
            tradelocker_connections.acc_num
          ),
          account_name = COALESCE(
            EXCLUDED.account_name,
            tradelocker_connections.account_name
          ),
          currency = COALESCE(
            EXCLUDED.currency,
            tradelocker_connections.currency
          ),
          status = 'connected',
          last_error = NULL,
          last_connected_at = NOW(),
          updated_at = NOW()`,
        [
          userId,
          envClean,
          srvClean,
          initialAccount
            ? initialAccount.id
            : null,
          initialAccount
            ? initialAccount.accNum
            : null,
          initialAccount
            ? initialAccount.accountName
            : null,
          initialAccount
            ? initialAccount.currency
            : null
        ]
      );

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
      console.error(
        '[TradeLocker Connect Error]:',
        err.message
      );

      await db(
        `INSERT INTO tradelocker_connections (
          user_id,
          environment,
          server,
          status,
          last_error,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          'error',
          $4,
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          status = 'error',
          last_error = EXCLUDED.last_error,
          updated_at = NOW()`,
        [
          userId,
          envClean,
          srvClean,
          err.message
        ]
      ).catch(() => {});

      return res.status(401).json({
        error:
          err.message ||
          'TradeLocker authentication failed.'
      });
    }
  });

  // ------------------------------------------------------------
  // ACCOUNTS
  // ------------------------------------------------------------
  router.get('/accounts', (req, res) => {
    const session =
      sessions.getSession(req.user.id);

    if (!session || !session.accessToken) {
      return res.status(401).json({
        error: 'Reconnect required.',
        reconnectRequired: true
      });
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

  // ------------------------------------------------------------
  // SELECT ACCOUNT
  // ------------------------------------------------------------
  router.post('/select-account', async (req, res) => {
    const userId = req.user.id;
    const { accountId } = req.body || {};

    if (!accountId) {
      return res.status(400).json({
        error: 'accountId is required.'
      });
    }

    const session =
      sessions.getSession(userId);

    if (!session || !session.accessToken) {
      return res.status(401).json({
        error:
          'Session expired or invalid. Please reconnect.',
        reconnectRequired: true
      });
    }

    const targetAccount =
      session.accounts.find(
        a => String(a.id) === String(accountId)
      );

    if (!targetAccount) {
      return res.status(403).json({
        error:
          'Forbidden: Selected account is not associated with this session.'
      });
    }

    session.selectedAccount = targetAccount;

    await db(
      `UPDATE tradelocker_connections SET
        account_id = $1,
        acc_num = $2,
        account_name = $3,
        currency = $4,
        status = 'connected',
        updated_at = NOW()
       WHERE user_id = $5`,
      [
        targetAccount.id,
        targetAccount.accNum,
        targetAccount.accountName,
        targetAccount.currency,
        userId
      ]
    );

    let state = null;

    if (
      targetAccount.accNum !== null &&
      targetAccount.accNum !== undefined &&
      !isNaN(Number(targetAccount.accNum))
    ) {
      try {
        state = await client.getAccountState({
          environment: session.environment,
          accessToken: session.accessToken,
          accountId: targetAccount.id,
          accNum: targetAccount.accNum
        });
      } catch (e) {
        console.warn(
          '[TradeLocker State Warning]:',
          e.message
        );
      }
    }

    return res.json({
      success: true,
      selectedAccount: targetAccount,
      state
    });
  });

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  router.get('/state', async (req, res) => {
    const userId = req.user.id;

    const session =
      sessions.getSession(userId);

    if (!session || !session.accessToken) {
      return res.status(401).json({
        error: 'Reconnect required.',
        reconnectRequired: true
      });
    }

    if (
      !session.selectedAccount ||
      !session.selectedAccount.id
    ) {
      return res.status(400).json({
        error:
          'No account currently selected. Please select an account first.'
      });
    }

    if (
      session.selectedAccount.accNum === null ||
      session.selectedAccount.accNum === undefined ||
      isNaN(Number(session.selectedAccount.accNum))
    ) {
      return res.status(400).json({
        error:
          'Selected account does not have a valid accNum required by TradeLocker.'
      });
    }

    try {
      const state =
        await client.getAccountState({
          environment: session.environment,
          accessToken: session.accessToken,
          accountId: session.selectedAccount.id,
          accNum: session.selectedAccount.accNum
        });

      return res.json({
        success: true,
        state
      });
    } catch (err) {
      return res.status(502).json({
        error:
          err.message ||
          'Failed to fetch account state from TradeLocker.'
      });
    }
  });
  router.get('/config', async (req, res) => {
  try {
    const userId = req.user.id;

    const session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        message: 'TradeLocker is not connected.'
      });
    }

const account = session.selectedAccount;

if (!account) {
  return res.status(400).json({
    success: false,
    message: 'No TradeLocker account selected.'
  });
}

const config =
  await client.getTradeConfig({
    environment: session.environment,
    accessToken: session.accessToken,
    accNum: account.accNum
  });

return res.json({
  success: true,
  config: config
});

  } catch (error) {
    console.error(
      'TradeLocker config error:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        'Failed to fetch TradeLocker config.'
    });
  }
});
  router.get('/instruments', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (
      !account ||
      account.accNum === undefined ||
      account.accNum === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

    const data = await client.getInstruments({
      environment: session.environment,
      accessToken: session.accessToken,
      accountId: account.id,
      accNum: account.accNum
    });

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      instruments: data
    });

  } catch (error) {
    console.error(
      '[TradeLocker Instruments Error]:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
  router.get('/instrument-details/:tradableInstrumentId/:routeId', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (
      !account ||
      account.accNum === undefined ||
      account.accNum === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

    const tradableInstrumentId =
      req.params.tradableInstrumentId;

    const routeId =
      req.params.routeId;

    const data = await client.getInstrumentDetails({
      environment: session.environment,
      accessToken: session.accessToken,
      tradableInstrumentId,
      routeId,
      accNum: account.accNum
    });

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      tradableInstrumentId,
      routeId,
      instrument: data
    });

  } catch (error) {
    console.error(
      '[TradeLocker Instrument Details Error]:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
  router.get('/account-details', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (
      !account ||
      account.accNum === undefined ||
      account.accNum === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

    const data = await client.getAccountDetails({
      environment: session.environment,
      accessToken: session.accessToken,
      accountId: account.id,
      accNum: account.accNum
    });

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      details: data
    });

  } catch (error) {
    console.error(
      '[TradeLocker Account Details Error]:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
  router.get('/positions', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (!account || account.accNum === undefined || account.accNum === null) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

const data = await client.getPositions({
  environment: session.environment,
  accessToken: session.accessToken,
  accNum: account.accNum,
  accountId: account.id
});

    res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      positions: data
    });

  } catch (error) {
    console.error(
      '[TradeLocker Positions Error]:',
      error.message
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
  router.get('/filled-orders', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (
      !account ||
      account.accNum === undefined ||
      account.accNum === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

    const data = await client.getFilledOrders({
      environment: session.environment,
      accessToken: session.accessToken,
      accountId: account.id,
      accNum: account.accNum
    });

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      filledOrders: data
    });

  } catch (error) {
    console.error(
      '[TradeLocker Filled Orders Error]:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;

    const session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        message: 'TradeLocker is not connected.'
      });
    }

    const account = session.selectedAccount;

    if (!account) {
      return res.status(400).json({
        success: false,
        message: 'No TradeLocker account selected.'
      });
    }

    const history =
      await client.getOrdersHistory({
        environment: session.environment,
        accessToken: session.accessToken,
        accountId: account.id,
        accNum: account.accNum
      });

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      history: history
    });

  } catch (error) {
    console.error(
      'TradeLocker history error:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: error.message ||
        'Failed to fetch TradeLocker history.'
    });
  }
});
  router.get('/sync-preview', async (req, res) => {
  try {
    const userId = req.user.id;

    let session = sessions.getSession(userId);

    if (!session || !session.accessToken) {
      session = await sessions.restoreSession(userId);
    }

    if (!session || !session.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'TradeLocker session not connected'
      });
    }

    const account = session.selectedAccount;

    if (
      !account ||
      account.accNum === undefined ||
      account.accNum === null
    ) {
      return res.status(400).json({
        success: false,
        error: 'No TradeLocker account selected'
      });
    }

    const history = await client.getOrdersHistory({
      environment: session.environment,
      accessToken: session.accessToken,
      accountId: account.id,
      accNum: account.accNum
    });
const instrumentsResponse = await client.getInstruments({
  environment: session.environment,
  accessToken: session.accessToken,
  accountId: account.id,
  accNum: account.accNum
});

const instrumentRows =
  instrumentsResponse &&
  instrumentsResponse.d &&
  Array.isArray(instrumentsResponse.d.instruments)
    ? instrumentsResponse.d.instruments
    : [];

const instrumentMap = new Map();

for (const instrument of instrumentRows) {
  if (
    instrument &&
    instrument.tradableInstrumentId !== undefined &&
    instrument.tradableInstrumentId !== null
  ) {
    instrumentMap.set(
      String(instrument.tradableInstrumentId),
      instrument
    );
  }
}
    const instrumentDetailsCache = new Map();

async function getInstrumentSpec(instrumentId, instrument) {
  const cacheKey = String(instrumentId);

  if (instrumentDetailsCache.has(cacheKey)) {
    return instrumentDetailsCache.get(cacheKey);
  }

  const routes =
    instrument &&
    Array.isArray(instrument.routes)
      ? instrument.routes
      : [];

  const tradeRoute =
    routes.find(route =>
      String(route.type).toUpperCase() === 'TRADE'
    );

  if (!tradeRoute) {
    throw new Error(
      'No TRADE route found for instrument ' + cacheKey
    );
  }

  const detailsResponse =
    await client.getInstrumentDetails({
      environment: session.environment,
      accessToken: session.accessToken,
      tradableInstrumentId: cacheKey,
      routeId: tradeRoute.id,
      accNum: account.accNum
    });

  const details =
    detailsResponse &&
    detailsResponse.d
      ? detailsResponse.d
      : null;

  if (!details) {
    throw new Error(
      'TradeLocker returned no instrument details for ' +
      cacheKey
    );
  }

  const spec = {
    instrumentId: cacheKey,
    name: details.name || instrument.name || cacheKey,
    lotSize: Number(details.lotSize || 0),
    lotStep: Number(details.lotStep || 0),
    minLot: Number(details.minLot || 0),
    maxLot: Number(details.maxLot || 0),
    quotingCurrency: details.quotingCurrency || null,
    tickSize:
      Array.isArray(details.tickSize) &&
      details.tickSize.length > 0
        ? Number(details.tickSize[0].tickSize || 0)
        : 0
  };

  instrumentDetailsCache.set(cacheKey, spec);

  return spec;
}
const rows =
  history &&
  history.d &&
  Array.isArray(history.d.ordersHistory)
    ? history.d.ordersHistory
    : [];

    const positionGroups = new Map();

    for (const row of rows) {
      if (!Array.isArray(row)) continue;

      const positionId = row[16];

      if (
        positionId === null ||
        positionId === undefined ||
        String(positionId).trim() === ''
      ) {
        continue;
      }

      if (!positionGroups.has(String(positionId))) {
        positionGroups.set(String(positionId), []);
      }

      positionGroups.get(String(positionId)).push(row);
    }

    const trades = [];

    for (const [positionId, group] of positionGroups.entries()) {
      const filled = group.filter(row =>
        String(row[6]).toLowerCase() === 'filled'
      );

      const openingOrders = filled.filter(row =>
        String(row[15]).toLowerCase() === 'true'
      );

      if (openingOrders.length !== 1) {
        continue;
      }

      const opening = openingOrders[0];

      const closingOrders = filled.filter(row =>
        String(row[15]).toLowerCase() !== 'true'
      );

      if (closingOrders.length === 0) {
        continue;
      }

      const openingSide =
        String(opening[4]).toUpperCase();

      const closingSide =
        openingSide === 'BUY'
          ? 'SELL'
          : 'BUY';

      const validClosingOrders =
        closingOrders.filter(row =>
          String(row[4]).toUpperCase() === closingSide
        );

      if (validClosingOrders.length === 0) {
        continue;
      }

 const instrumentId = String(opening[1]);

const instrument =
  instrumentMap.get(instrumentId);

const symbol =
  instrument && instrument.name
    ? instrument.name
    : instrumentId;
const instrumentSpec =
  await getInstrumentSpec(
    instrumentId,
    instrument
  );

const lotSize =
  instrumentSpec.lotSize;
      const quantity =
        Number(opening[7] || opening[3] || 0);

      const entry =
        Number(opening[8] || 0);

      let closingQuantity = 0;
      let closingValue = 0;

      for (const row of validClosingOrders) {
        const qty =
          Number(row[7] || row[3] || 0);

        const price =
          Number(row[8] || 0);

        if (
          Number.isFinite(qty) &&
          Number.isFinite(price) &&
          qty > 0
        ) {
          closingQuantity += qty;
          closingValue += qty * price;
        }
      }

      const exitPrice =
        closingQuantity > 0
          ? closingValue / closingQuantity
          : 0;

const grossProfitLossRaw =
  openingSide === 'BUY'
    ? (exitPrice - entry) * quantity * lotSize
    : (entry - exitPrice) * quantity * lotSize;

const grossProfitLoss =
  Math.round(
    (grossProfitLossRaw + Number.EPSILON) * 100
  ) / 100;

trades.push({
  positionId,
  symbol,
  direction: openingSide,
  quantity,
  entry,
  exitPrice,
  lotSize,
  grossProfitLoss,
  openingOrderId: opening[0],
  closingOrderCount: validClosingOrders.length,
  source: 'tradelocker'
});
    }

    return res.json({
      success: true,
      account: {
        id: account.id,
        accNum: account.accNum
      },
      historyRows: rows.length,
      positionGroups: positionGroups.size,
      completedTrades: trades.length,
      trades
    });

  } catch (error) {
    console.error(
      '[TradeLocker Sync Preview Error]:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
  // ------------------------------------------------------------
  // DISCONNECT
  // ------------------------------------------------------------
  router.post('/disconnect', async (req, res) => {
    const userId = req.user.id;

    sessions.clearSession(userId);

    await db(
      `UPDATE tradelocker_connections
       SET status = 'disconnected',
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    ).catch(() => {});

    return res.json({
      success: true,
      status: 'disconnected',
      message: 'TradeLocker disconnected.'
    });
  });

  return router;
}

module.exports = {
  createTradeLockerRouter
};
