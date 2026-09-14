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

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'accNum': String(accNum)
    };

    const response = await fetch(
      `${baseUrl}/trade/accounts/${encodeURIComponent(accountId)}/state`,
      {
        method: 'GET',
        headers
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        `Failed to fetch account state (${response.status})`
      );
    }

    const root = data.d !== undefined
      ? data.d
      : data;

    const state = Array.isArray(root)
      ? (root[0] || {})
      : (root.state || root);

    return {
      balance:
        state.balance !== undefined
          ? Number(state.balance)
          : null,

      equity:
        state.equity !== undefined
          ? Number(state.equity)
          : null,

      freeMargin:
        state.freeMargin !== undefined
          ? Number(state.freeMargin)
          : null,

      marginUsed:
        state.marginUsed !== undefined
          ? Number(state.marginUsed)
          : null,

      unrealizedPl:
        state.unrealizedPl !== undefined
          ? Number(state.unrealizedPl)
          : null
    };
  }
}

module.exports = { TradeLockerClient };
