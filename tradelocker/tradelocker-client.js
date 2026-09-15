```js
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


  async authenticate({
    environment,
    server,
    email,
    password
  }) {
    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(
      `${baseUrl}/auth/jwt/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          server
        })
      }
    );

    const data =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg =
        data.message ||
        data.error ||
        `Authentication failed (${response.status})`;

      throw new Error(msg);
    }

    if (!data.accessToken) {
      throw new Error(
        'TradeLocker did not return an access token.'
      );
    }

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || null
    };
  }


  async refreshAccessToken({
    environment,
    refreshToken
  }) {
    if (!refreshToken) {
      throw new Error(
        'No refresh token provided.'
      );
    }

    const baseUrl =
      this.getBaseUrl(environment);

    const response = await fetch(
      `${baseUrl}/auth/jwt/refresh`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          refreshToken
        })
      }
    );

    const data =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Token refresh failed'
      );
    }

    return {
      accessToken: data.accessToken,
      refreshToken:
        data.refreshToken || refreshToken
    };
  }


  async getAllAccounts({
    environment,
    accessToken
  }) {
    const baseUrl =
      this.getBaseUrl(environment);

    const response = await fetch(
      `${baseUrl}/auth/jwt/all-accounts`,
      {
        method: 'GET',
        headers: {
          'Authorization':
            `Bearer ${accessToken}`,
          'Accept':
            'application/json'
        }
      }
    );

    const data =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        `Failed to fetch TradeLocker accounts (${response.status})`
      );
    }

    const rawAccounts =
      Array.isArray(data)
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
          rawAccNum =
            Number(acc.accNum);

        } else if (
          acc.accountNumber !== undefined &&
          acc.accountNumber !== null &&
          !isNaN(Number(acc.accountNumber))
        ) {
          rawAccNum =
            Number(acc.accountNumber);
        }

        return {
          id:
            String(rawId || ''),

          accNum:
            rawAccNum,

          accountName:
            acc.name ||
            acc.accountName ||
            acc.account_name ||
            'TradeLocker Account',

          currency:
            acc.currency || 'USD',

          status:
            acc.status || 'Active'
        };
      })
      .filter(
        account =>
          Boolean(account.id)
      );
  }


  async getAccountState({
    environment,
    accessToken,
    accountId,
    accNum
  }) {

    if (!accountId) {
      throw new Error(
        'accountId is required to fetch state.'
      );
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

    const baseUrl =
      this.getBaseUrl(environment);

    const url =
      `${baseUrl}/trade/accounts/` +
      `${encodeURIComponent(accountId)}/state`;

    const headers = {
      'Authorization':
        `Bearer ${accessToken}`,

      'Accept':
        'application/json',

      'accNum':
        String(accNum)
    };


    /*
     * Get account state.
     */
    const response = await fetch(
      url,
      {
        method: 'GET',
        headers
      }
    );


    const text =
      await response.text();


    let data = {};

    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      data = {};
    }


    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        `Failed to fetch account state (${response.status})`
      );
    }


    /*
     * Never attempt to parse authentication
     * responses as account state.
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


    /*
     * TradeLocker returns:
     *
     * data.d.accountDetailsData
     *
     * The array order is defined by
     * accountDetailsConfig.columns.
     *
     * Confirmed mapping:
     *
     * 0  = balance
     * 1  = projectedBalance
     * 2  = availableFunds
     * 9  = initialMarginReq
     * 23 = openNetPnL
     */

    const accountDetailsData =
      data?.d?.accountDetailsData;


    if (
      !Array.isArray(accountDetailsData)
    ) {
      return {
        balance: null,
        equity: null,
        freeMargin: null,
        marginUsed: null,
        unrealizedPl: null
      };
    }


    /*
     * Map TradeLocker account state.
     */

    const balance =
      Number(accountDetailsData[0]) || 0;

    const projectedBalance =
      Number(accountDetailsData[1]) || 0;

    const availableFunds =
      Number(accountDetailsData[2]) || 0;

    const initialMarginReq =
      Number(accountDetailsData[9]) || 0;

    const openNetPnL =
      Number(accountDetailsData[23]) || 0;


    /*
     * Return the structure expected by
     * the GhostTrader frontend.
     */

    return {
      balance,

      equity:
        projectedBalance,

      freeMargin:
        availableFunds,

      marginUsed:
        initialMarginReq,

      unrealizedPl:
        openNetPnL
    };
  }
}


module.exports = {
  TradeLockerClient
};
```
