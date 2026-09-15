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
          'Accept': 'application/json'
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
          id: String(rawId || ''),

          accNum: rawAccNum,

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
        account => Boolean(account.id)
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

    const headers = {
      'Authorization':
        `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'accNum': String(accNum)
    };


    /*
     * --------------------------------------------------
     * 1. GET TRADELOCKER CONFIG
     * --------------------------------------------------
     *
     * TradeLocker documents /trade/config as the
     * source for the field names/order used by
     * accountDetailsData.
     */

    const configResponse = await fetch(
      `${baseUrl}/trade/config`,
      {
        method: 'GET',
        headers
      }
    );

    const configText =
      await configResponse.text();

    let configData = {};

    try {
      configData =
        configText
          ? JSON.parse(configText)
          : {};
    } catch {
      configData = {};
    }


    /*
     * SAFE CONFIG DIAGNOSTICS
     *
     * Never print accessToken/refreshToken.
     */
    const safeConfig = {
      status:
        configResponse.status,

      contentType:
        configResponse.headers.get(
          'content-type'
        ) || '',

      topLevelKeys:
        configData &&
        typeof configData === 'object'
          ? Object.keys(configData)
          : [],

      dType:
        configData?.d !== undefined
          ? Array.isArray(configData.d)
            ? 'array'
            : typeof configData.d
          : 'missing',

      dKeys:
        configData?.d &&
        typeof configData.d === 'object' &&
        !Array.isArray(configData.d)
          ? Object.keys(configData.d)
          : []
    };


    console.log(
      '[TRADELOCKER CONFIG RESPONSE]',
      safeConfig
    );


    /*
     * Show the accountDetails-related portion
     * without exposing credentials.
     */

    const configD =
      configData?.d || configData;


    const accountConfig =
      configD?.accountDetails ||
      configD?.accountDetailsConfig ||
      configD?.accountDetailsData ||
      null;


    if (
      accountConfig &&
      typeof accountConfig === 'object'
    ) {

      console.log(
        '[TRADELOCKER ACCOUNT CONFIG]',
        {
          type:
            Array.isArray(accountConfig)
              ? 'array'
              : typeof accountConfig,

          length:
            Array.isArray(accountConfig)
              ? accountConfig.length
              : null,

          keys:
            !Array.isArray(accountConfig)
              ? Object.keys(accountConfig)
              : [],

          preview:
            Array.isArray(accountConfig)
              ? accountConfig.map(
                  (value, index) => ({
                    index,

                    type:
                      Array.isArray(value)
                        ? 'array'
                        : typeof value,

                    value:
                      value !== null &&
                      typeof value === 'object'
                        ? Object.keys(value)
                        : value
                  })
                )
              : null
        }
      );
    }


    /*
     * --------------------------------------------------
     * 2. GET ACCOUNT STATE
     * --------------------------------------------------
     */

    const stateUrl =
      `${baseUrl}/trade/accounts/` +
      `${encodeURIComponent(accountId)}/state`;


    console.log(
      '[TRADELOCKER STATE REQUEST]',
      {
        environment,
        url: stateUrl,
        accountId: String(accountId),
        accNum: String(accNum)
      }
    );


    const response = await fetch(
      stateUrl,
      {
        method: 'GET',
        headers
      }
    );


    const contentType =
      response.headers.get(
        'content-type'
      ) || '';


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


    /*
     * --------------------------------------------------
     * 3. SAFE STATE DIAGNOSTICS
     * --------------------------------------------------
     */

    const accountDetailsData =
      data?.d?.accountDetailsData;


    const safeData = {

      status:
        response.status,

      contentType,

      keys:
        data &&
        typeof data === 'object'
          ? Object.keys(data)
          : [],

      dKeys:
        data?.d &&
        typeof data.d === 'object' &&
        !Array.isArray(data.d)
          ? Object.keys(data.d)
          : [],

      accountDetailsDataLength:
        Array.isArray(accountDetailsData)
          ? accountDetailsData.length
          : null,

      accountDetailsDataPreview:
        Array.isArray(accountDetailsData)
          ? accountDetailsData.map(
              (value, index) => ({
                index,

                type:
                  Array.isArray(value)
                    ? 'array'
                    : typeof value,

                value:
                  value !== null &&
                  typeof value === 'object'
                    ? Object.keys(value)
                    : value
              })
            )
          : []
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
     * --------------------------------------------------
     * TEMPORARY
     *
     * Do not guess indexes yet.
     * --------------------------------------------------
     */

    return {
      balance: null,
      equity: null,
      freeMargin: null,
      marginUsed: null,
      unrealizedPl: null
    };
  }
}


module.exports = {
  TradeLockerClient
};
