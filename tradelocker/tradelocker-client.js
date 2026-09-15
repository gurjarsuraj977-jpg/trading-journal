/**
 * TradeLocker API Client (Phase 1)
 * Handles Demo & Live TradeLocker endpoints with zero credential persistence.
 */

const TL_ENDPOINTS = {
  demo: 'https://demo.tradelocker.com/backend-api',
  live: 'https://live.tradelocker.com/backend-api'
};

class TradeLockerClient {
  getBaseUrl(environment) {
    const env = (environment || '').toLowerCase().trim();
    const url = TL_ENDPOINTS[env];

    if (!url) {
      throw new Error(
        `Invalid TradeLocker environment: "${environment}". Must be "demo" or "live".`
      );
    }

    return url;
  }

  async authenticate({ environment, server, email, password }) {
    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(`${baseUrl}/auth/jwt/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ email, password, server })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg =
        data.message ||
        data.error ||
        `Authentication failed (${response.status})`;

      throw new Error(msg);
    }

    if (!data.accessToken) {
      throw new Error('TradeLocker did not return an access token.');
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || null
    };
  }

  async refreshAccessToken({ environment, refreshToken }) {
    if (!refreshToken) {
      throw new Error('No refresh token provided.');
    }

    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(`${baseUrl}/auth/jwt/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ refreshToken })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || 'Token refresh failed');
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken
    };
  }

  async getAllAccounts({ environment, accessToken }) {
    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(`${baseUrl}/auth/jwt/all-accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        `Failed to fetch TradeLocker accounts (${response.status})`
      );
    }

    const rawAccounts = Array.isArray(data)
      ? data
      : (data.accounts || []);

    return rawAccounts
      .map(acc => {
        const rawId =
          acc.id !== undefined
            ? acc.id
            : acc.accountId;

        let rawAccNum = null;

        if (
          acc.accNum !== undefined &&
          acc.accNum !== null &&
          !isNaN(Number(acc.accNum))
        ) {
          rawAccNum = Number(acc.accNum);
        } else if (
          acc.accountNumber !== undefined &&
          acc.accountNumber !== null &&
          !isNaN(Number(acc.accountNumber))
        ) {
          rawAccNum = Number(acc.accountNumber);
        }

        return {
          id: String(rawId || ''),
          accNum: rawAccNum,
          accountName:
            acc.name ||
            acc.accountName ||
            acc.account_name ||
            'TradeLocker Account',
          currency: acc.currency || 'USD',
          status: acc.status || 'Active'
        };
      })
      .filter(a => Boolean(a.id));
  }

async getAccountState({
async getAccountState({
  environment,
  accessToken,
  accountId,
  accNum
}) {
  if (!accountId) {
    throw new Error('accountId is required to fetch state.');
  }

  if (
    accNum === null ||
    accNum === undefined ||
    isNaN(Number(accNum))
  ) {
    throw new Error(
      'accNum is missing or invalid; cannot query account state.'
    );
  }

  const baseUrl = this.getBaseUrl(environment);

  const url =
    `${baseUrl}/trade/accounts/` +
    `${encodeURIComponent(accountId)}/state`;

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'accNum': String(accNum)
  };

  console.log('[TRADELOCKER STATE REQUEST]', {
    environment,
    url,
    accountId: String(accountId),
    accNum: String(accNum)
  });

  const response = await fetch(url, {
    method: 'GET',
    headers
  });

  const contentType =
    response.headers.get('content-type') || '';

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  /*
   * NEVER log accessToken / refreshToken.
   */
  const safeData = {
    status: response.status,
    contentType,
    keys:
      data && typeof data === 'object'
        ? Object.keys(data)
        : [],
    hasAccessToken:
      Boolean(data && data.accessToken),
    hasRefreshToken:
      Boolean(data && data.refreshToken),
    expireDate:
      data && data.expireDate
        ? data.expireDate
        : null
  };

  console.log(
    '[TRADELOCKER STATE RESPONSE]',
    safeData
  );

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Failed to fetch account state (${response.status})`
    );
  }

  /*
   * If TradeLocker unexpectedly returned an authentication
   * response instead of account state, stop here.
   */
  if (
    data &&
    (
      data.accessToken ||
      data.refreshToken
    )
  ) {
    throw new Error(
      'TradeLocker returned authentication data instead of account state.'
    );
  }

  const root =
    data && data.d !== undefined
      ? data.d
      : data;

  let state = root;

  if (
    root &&
    typeof root === 'object' &&
    !Array.isArray(root)
  ) {
    if (
      root.state &&
      typeof root.state === 'object'
    ) {
      state = root.state;
    } else if (
      root.account &&
      typeof root.account === 'object'
    ) {
      state = root.account;
    } else if (
      root.data &&
      typeof root.data === 'object'
    ) {
      state = root.data;
    }
  }

  if (Array.isArray(state)) {
    state = state[0] || {};
  }

  if (!state || typeof state !== 'object') {
    state = {};
  }

  const getNumber = (...keys) => {
    for (const key of keys) {
      const value = state[key];

      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        const number = Number(value);

        if (Number.isFinite(number)) {
          return number;
        }
      }
    }

    return null;
  };

  return {
    balance: getNumber(
      'balance',
      'Balance',
      'accountBalance',
      'account_balance'
    ),

    equity: getNumber(
      'equity',
      'Equity',
      'accountEquity',
      'account_equity'
    ),

    freeMargin: getNumber(
      'freeMargin',
      'free_margin',
      'FreeMargin',
      'availableMargin',
      'available_margin'
    ),

    marginUsed: getNumber(
      'marginUsed',
      'margin_used',
      'MarginUsed',
      'usedMargin',
      'used_margin'
    ),

    unrealizedPl: getNumber(
      'unrealizedPl',
      'unrealizedPL',
      'unrealizedPnl',
      'unrealizedPnL',
      'unrealized_pnl',
      'UnrealizedPL'
    )
  };
}
}

module.exports = { TradeLockerClient };
