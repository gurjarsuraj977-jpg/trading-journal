/**
 * TradeLocker Phase 1 Router
 * Wired to GhostTrader V8 auth middleware and single PostgreSQL db helper.
 */

const express = require('express');
const { TradeLockerClient } = require('./tradelocker-client');
const { TradeLockerSessionManager } = require('./tradelocker-auth');
const { validateInstrumentSpec, resolveCanonicalSymbol } = require('../utils/instrument-spec');
const { getCurrencyConversionRate } = require('../market-data/twelve-data');

/**
 * Persist the broker's ACTUAL instrument specification into
 * market_symbols (the existing instrument architecture:
 * symbol / broker_symbol / price_decimals / quantity_decimals /
 * tick_size / contract_size).
 *
 * Non-destructive: only fills fields that are still NULL/0 so a
 * manually curated row is never overwritten by a sync.
 */
async function upsertMarketSymbolFromBrokerSpec(db, spec) {
  const symbol =
    (spec.symbol && String(spec.symbol).trim()) ||
    resolveCanonicalSymbol(spec.name);

  if (!symbol || !Number.isFinite(spec.lotSize) || spec.lotSize <= 0) {
    return false;
  }

  try {
    await db(
      `INSERT INTO market_symbols (
         symbol,
         display_name,
         asset_class,
         quote_asset,
         broker_symbol,
         price_decimals,
         quantity_decimals,
         tick_size,
         contract_size,
         updated_at
       )
       VALUES ($1, $2, 'index', $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (symbol) DO UPDATE SET
         display_name = COALESCE(market_symbols.display_name, EXCLUDED.display_name),
         asset_class = CASE
           WHEN market_symbols.asset_class = 'forex'
             AND market_symbols.contract_size IS NULL
             THEN EXCLUDED.asset_class
           ELSE market_symbols.asset_class
         END,
         quote_asset = COALESCE(market_symbols.quote_asset, EXCLUDED.quote_asset),
         broker_symbol = COALESCE(market_symbols.broker_symbol, EXCLUDED.broker_symbol),
         tick_size = COALESCE(market_symbols.tick_size, EXCLUDED.tick_size),
         contract_size = CASE
           WHEN market_symbols.contract_size IS NULL
             OR market_symbols.contract_size = 0
             THEN EXCLUDED.contract_size
           ELSE market_symbols.contract_size
         END,
         updated_at = NOW()`,
      [
        symbol,
        spec.name || symbol,
        spec.quotingCurrency || 'USD',
        spec.name || symbol,
        2,
        2,
        spec.tickSize,
        spec.lotSize
      ]
    );

    return true;
  } catch (err) {
    console.warn(
      '[TradeLocker market_symbols upsert warning]:',
      err.message
    );
    return false;
  }
}

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

  /*
   * Strict validation: a missing/zero lotSize is REJECTED here
   * with an explicit diagnostic instead of being coerced to 0
   * and silently producing wrong P&L.
   */
  const validated = validateInstrumentSpec({
    instrumentId: cacheKey,
    name: details.name || (instrument && instrument.name) || cacheKey,
    lotSize: details.lotSize,
    lotStep: details.lotStep,
    minLot: details.minLot,
    maxLot: details.maxLot,
    quotingCurrency: details.quotingCurrency,
    tickSize: details.tickSize
  });

  if (!validated.valid) {
    throw new Error(validated.error);
  }

  const spec = validated.spec;

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

const stopLoss =
  opening[17] !== null &&
  opening[17] !== undefined &&
  opening[17] !== ''
    ? Number(opening[17])
    : null;

const takeProfit =
  opening[19] !== null &&
  opening[19] !== undefined &&
  opening[19] !== ''
    ? Number(opening[19])
    : null;

const tradeDate =
  opening[13] !== null &&
  opening[13] !== undefined &&
  opening[13] !== ''
    ? new Date(Number(opening[13])).toISOString()
    : null;

trades.push({
  positionId,
  symbol,
  direction: openingSide,
  quantity,
  entry,
  exitPrice,
  stopLoss,
  takeProfit,
  tradeDate,
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
  router.post('/sync', async (req, res) => {
    try {
      const userId = req.user.id;

      let session = sessions.getSession(userId);

      if (!session || !session.accessToken) {
        session = await sessions.restoreSession(userId);
      }

      if (!session || !session.accessToken) {
        return res.status(401).json({
          success: false,
          error: 'TradeLocker session is not connected.'
        });
      }

      if (
        !session.selectedAccount ||
        !session.selectedAccount.id ||
        session.selectedAccount.accNum === undefined ||
        session.selectedAccount.accNum === null
      ) {
        return res.status(400).json({
          success: false,
          error: 'No TradeLocker account selected'
        });
      }

      const account = session.selectedAccount;
// ----------------------------------------------------------
// ENSURE TRADELOCKER GENERAL ACCOUNT EXISTS
// ----------------------------------------------------------

const tradeLockerAccountName =
  account.accountName ||
  String(account.id);

/*
 * TradeLocker account currency. Used to convert P&L when the
 * instrument's quoting currency differs from the account
 * currency (same conversion path as manual trades).
 */
const tlAccountCurrency = String(
  account.currency || 'USD'
)
  .trim()
  .toUpperCase();

await db(
  `
  INSERT INTO accounts (
    user_id,
    name,
    starting_balance,
    currency
  )
  VALUES (
    $1,
    $2,
    0,
    $3
  )
  ON CONFLICT (user_id, name)
  DO NOTHING
  `,
  [
    userId,
    tradeLockerAccountName,
    account.currency || 'USD'
  ]
);
      // ----------------------------------------------------------
      // GET TRADELOCKER HISTORY
      // ----------------------------------------------------------

      const history = await client.getOrdersHistory({
        environment: session.environment,
        accessToken: session.accessToken,
        accountId: account.id,
        accNum: account.accNum
      });

      const rows =
        history &&
        history.d &&
        Array.isArray(history.d.ordersHistory)
          ? history.d.ordersHistory
          : [];

      // ----------------------------------------------------------
      // GET INSTRUMENTS
      // ----------------------------------------------------------

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

      // ----------------------------------------------------------
      // INSTRUMENT DETAILS CACHE
      // ----------------------------------------------------------

      const instrumentDetailsCache = new Map();
      const invalidInstrumentSpecs = [];

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

        /*
         * Strict validation: a missing/zero lotSize is REJECTED here
         * with an explicit diagnostic instead of being coerced to 0
         * and silently producing wrong P&L.
         */
        const validated = validateInstrumentSpec({
          instrumentId: cacheKey,
          name:
            details.name ||
            (instrument && instrument.name) ||
            cacheKey,
          lotSize: details.lotSize,
          lotStep: details.lotStep,
          minLot: details.minLot,
          maxLot: details.maxLot,
          quotingCurrency: details.quotingCurrency,
          tickSize: details.tickSize
        });

        if (!validated.valid) {
          const err = new Error(validated.error);
          err.instrumentSpecDiagnostics = validated.diagnostics;
          throw err;
        }

        const spec = validated.spec;

        instrumentDetailsCache.set(cacheKey, spec);

        return spec;
      }

      // ----------------------------------------------------------
      // GROUP ORDERS BY POSITION
      // ----------------------------------------------------------

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

        const key = String(positionId);

        if (!positionGroups.has(key)) {
          positionGroups.set(key, []);
        }

        positionGroups.get(key).push(row);
      }

      // ----------------------------------------------------------
      // BUILD COMPLETED TRADES
      // ----------------------------------------------------------

      const normalizedTrades = [];

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

        // --------------------------------------------------------
        // INSTRUMENT
        // --------------------------------------------------------

        const instrumentId =
          String(opening[1]);

        const instrument =
          instrumentMap.get(instrumentId);

        let instrumentSpec;

        try {
          instrumentSpec =
            await getInstrumentSpec(
              instrumentId,
              instrument
            );
        } catch (specErr) {
          /*
           * Invalid instrument specification (e.g. missing/zero
           * lotSize): never import with a fabricated contract
           * size. Record the exact diagnostic and skip this
           * position so valid trades still sync.
           */
          invalidInstrumentSpecs.push({
            positionId,
            instrumentId,
            error: specErr.message,
            diagnostics:
              specErr.instrumentSpecDiagnostics || null
          });

          continue;
        }

        const symbol =
          instrumentSpec.name || instrumentId;

        const lotSize =
          instrumentSpec.lotSize;

        // --------------------------------------------------------
        // OPENING
        // --------------------------------------------------------

        const quantity =
          Number(opening[7] || opening[3] || 0);

        const entry =
          Number(opening[8] || 0);

        if (
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(entry)
        ) {
          continue;
        }

        // --------------------------------------------------------
        // CLOSING
        // --------------------------------------------------------

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

        if (
          !Number.isFinite(closingQuantity) ||
          closingQuantity <= 0
        ) {
          continue;
        }

        const exitPrice =
          closingValue / closingQuantity;

        // --------------------------------------------------------
        // GROSS PRICE P/L
        // --------------------------------------------------------

        const grossProfitLossRaw =
          openingSide === 'BUY'
            ? (exitPrice - entry) *
              quantity *
              lotSize
            : (entry - exitPrice) *
              quantity *
              lotSize;

        const grossProfitLoss =
          Math.round(
            (grossProfitLossRaw + Number.EPSILON) * 100
          ) / 100;

        /*
         * If the instrument quotes in a different currency than
         * the account, convert using the same conversion helper
         * manual trades use. Failure to convert is recorded as a
         * diagnostic — never fabricated.
         */
        let pnlConversionRate = null;
        let conversionWarning = null;

        if (
          instrumentSpec.quotingCurrency &&
          instrumentSpec.quotingCurrency !== tlAccountCurrency
        ) {
          try {
            const conversion =
              await getCurrencyConversionRate({
                fromCurrency: instrumentSpec.quotingCurrency,
                toCurrency: tlAccountCurrency
              });

            pnlConversionRate = conversion.rate;
          } catch (convErr) {
            conversionWarning = convErr.message;
          }
        }

        // --------------------------------------------------------
        // SL / TP
        // --------------------------------------------------------

        const stopLoss =
          opening[17] !== null &&
          opening[17] !== undefined &&
          opening[17] !== ''
            ? Number(opening[17])
            : null;

        const takeProfit =
          opening[19] !== null &&
          opening[19] !== undefined &&
          opening[19] !== ''
            ? Number(opening[19])
            : null;

        // --------------------------------------------------------
        // TRADE DATE
        // --------------------------------------------------------

        const tradeDate =
          opening[13] !== null &&
          opening[13] !== undefined &&
          opening[13] !== ''
            ? new Date(
                Number(opening[13])
              ).toISOString()
            : null;

        normalizedTrades.push({
          positionId,
          openingOrderId: String(opening[0]),
          symbol,
          direction: openingSide,
          quantity,
          entry,
          exitPrice,
          stopLoss,
          takeProfit,
          tradeDate,
          lotSize,
          grossProfitLoss,
          pnlConversionRate,
          conversionWarning,
          instrumentSpec
        });
      }

      // ----------------------------------------------------------
      // STORE THE BROKER'S ACTUAL INSTRUMENT SPECIFICATIONS
      // (market_symbols: symbol / broker_symbol / tick_size /
      //  contract_size ...). Non-destructive upsert.
      // ----------------------------------------------------------

      const storedSpecs = new Map();

      for (const trade of normalizedTrades) {
        const spec = trade.instrumentSpec;

        if (spec && !storedSpecs.has(spec.instrumentId)) {
          storedSpecs.set(
            spec.instrumentId,
            await upsertMarketSymbolFromBrokerSpec(db, spec)
          );
        }
      }

      // ----------------------------------------------------------
      // IMPORT INTO POSTGRESQL
      // ----------------------------------------------------------

      let inserted = 0;
      let skipped = 0;

      for (const trade of normalizedTrades) {
        const result = await db(
          `
          INSERT INTO trades (
            user_id,
            account,
            symbol,
            direction,
            entry,
            stop_loss,
            take_profit,
            exit_price,
            quantity,
            profit_loss,
            trade_date,
            source,
            external_trade_id,
            external_position_id,
            external_account_id,
            external_imported_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            'tradelocker',
            $12,
            $13,
            $14,
            NOW()
          )
          ON CONFLICT (
            user_id,
            external_account_id,
            external_position_id
          )
          WHERE source = 'tradelocker'
            AND external_position_id IS NOT NULL
          DO NOTHING
          RETURNING id
          `,
          [
            userId,
tradeLockerAccountName,
            trade.symbol,
            trade.direction,
            trade.entry,
            trade.stopLoss,
            trade.takeProfit,
            trade.exitPrice,
            trade.quantity,
            trade.grossProfitLoss,
            trade.tradeDate,
            trade.openingOrderId,
            trade.positionId,
            String(account.id)
          ]
        );

        if (
          result &&
          result.rows &&
          result.rows.length > 0
        ) {
          inserted++;
        } else {
          skipped++;
        }
      }

      // ----------------------------------------------------------
      // RESPONSE
      // ----------------------------------------------------------

      return res.json({
        success: true,
        dryRun: false,

        account: {
          id: account.id,
          accNum: account.accNum,
          name: account.accountName || null
        },

        historyRows: rows.length,
        positionGroups: positionGroups.size,
        normalizedTrades: normalizedTrades.length,

        inserted,
        skipped,

        /*
         * Explicit diagnostics: instruments whose TradeLocker
         * specification was invalid (e.g. missing/zero lotSize)
         * were rejected and NOT imported with a fabricated
         * contract size.
         */
        rejectedInstrumentSpecs: invalidInstrumentSpecs,
        instrumentSpecsStored: storedSpecs.size,

        message:
          invalidInstrumentSpecs.length > 0
            ? 'TradeLocker trades synced, but ' +
              invalidInstrumentSpecs.length +
              ' position(s) were skipped due to invalid ' +
              'instrument specifications.'
            : 'TradeLocker trades synced successfully.'
      });

    } catch (error) {
      console.error(
        '[TradeLocker Sync Error]',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          'TradeLocker sync failed.'
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
