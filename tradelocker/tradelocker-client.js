/**
 * TradeLocker API Client
 * Demo & Live TradeLocker endpoints.
 */

const TL_ENDPOINTS = {
  demo: 'https://demo.tradelocker.com/backend-api',
  live: 'https://live.tradelocker.com/backend-api'
};

class TradeLockerClient {

  getBaseUrl(environment) {
    const env = String(environment || '').toLowerCase().trim();
    const url = TL_ENDPOINTS[env];

    if (!url) {
      throw new Error(
        'Invalid TradeLocker environment: "' +
        environment +
        '". Must be "demo" or "live".'
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
      baseUrl + '/auth/jwt/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email: email,
          password: password,
          server: server
        })
      }
    );

    const data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      const msg =
        data.message ||
        data.error ||
        ('Authentication failed (' + response.status + ')');

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

    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(
      baseUrl + '/auth/jwt/refresh',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          refreshToken: refreshToken
        })
      }
    );

    const data = await response.json().catch(function () {
      return {};
    });

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
    const baseUrl = this.getBaseUrl(environment);

    const response = await fetch(
      baseUrl + '/auth/jwt/all-accounts',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      throw new Error(
        data.message ||
        (
          'Failed to fetch TradeLocker accounts (' +
          response.status +
          ')'
        )
      );
    }

    const rawAccounts =
      Array.isArray(data)
        ? data
        : (data.accounts || []);

    return rawAccounts
      .map(function (acc) {

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

          currency:
            acc.currency || 'USD',

          status:
            acc.status || 'Active'
        };
      })
      .filter(function (account) {
        return Boolean(account.id);
      });
  }
async getPositions({
  environment,
  accessToken,
  accNum,
  accountId
}) {
  if (
    accNum === null ||
    accNum === undefined ||
    isNaN(Number(accNum))
  ) {
    throw new Error(
      'accNum is missing or invalid; cannot query TradeLocker positions.'
    );
  }

  if (
    accountId === null ||
    accountId === undefined ||
    String(accountId).trim() === ''
  ) {
    throw new Error(
      'accountId is missing or invalid; cannot query TradeLocker positions.'
    );
  }

  const baseUrl = this.getBaseUrl(environment);
  
const endpoint =
  baseUrl +
  '/trade/accounts/' +
  encodeURIComponent(String(accountId)) +
  '/positions';

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Accept': 'application/json',
      'accNum': String(accNum)
    }
  });

  const text = await response.text();

  console.log(
    '[TradeLocker Positions Debug]',
    JSON.stringify({
      endpoint,
      status: response.status,
      response: text
    })
  );

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      data.raw ||
      (
        'Failed to fetch TradeLocker positions (' +
        response.status +
        ')'
      )
    );
  }

  return data;
}
  async getPositions({
  environment,
  accessToken,
  accNum,
  accountId
}) {
  // your existing getPositions code...

  return data;
}


// ADD THIS BELOW getPositions()

async getFilledOrders({
  environment,
  accessToken,
  accountId,
  accNum
}) {
  if (
    accountId === null ||
    accountId === undefined ||
    String(accountId).trim() === ''
  ) {
    throw new Error(
      'accountId is missing or invalid; cannot query TradeLocker filled orders.'
    );
  }

  if (
    accNum === null ||
    accNum === undefined ||
    isNaN(Number(accNum))
  ) {
    throw new Error(
      'accNum is missing or invalid; cannot query TradeLocker filled orders.'
    );
  }

  const baseUrl = this.getBaseUrl(environment);

  const endpoint =
    baseUrl +
    '/trade/accounts/' +
    encodeURIComponent(String(accountId)) +
    '/executions';

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Accept': 'application/json',
      'accNum': String(accNum)
    }
  });

  const text = await response.text();

  console.log(
    '[TradeLocker Filled Orders Debug]',
    JSON.stringify({
      endpoint,
      status: response.status,
      response: text
    })
  );

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      data.raw ||
      ('Failed to fetch TradeLocker filled orders (' + response.status + ')')
    );
  }

  return data;
}
  async getOrdersHistory({
    environment,
    accessToken,
    accountId,
    accNum,
    from,
    to
  }) {
    if (!accountId) {
      throw new Error(
        'accountId is required to fetch orders history.'
      );
    }

    if (
      accNum === null ||
      accNum === undefined ||
      isNaN(Number(accNum))
    ) {
      throw new Error(
        'accNum is missing or invalid; cannot query orders history.'
      );
    }

    const baseUrl = this.getBaseUrl(environment);

    let url =
      baseUrl +
      '/trade/accounts/' +
      encodeURIComponent(accountId) +
      '/ordersHistory';

    const params = [];

    if (
      from !== undefined &&
      from !== null
    ) {
      params.push(
        'from=' + encodeURIComponent(String(from))
      );
    }

    if (
      to !== undefined &&
      to !== null
    ) {
      params.push(
        'to=' + encodeURIComponent(String(to))
      );
    }

    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const response = await fetch(
      url,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Accept': 'application/json',
          'accNum': String(accNum)
        }
      }
    );

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        (
          'Failed to fetch TradeLocker orders history (' +
          response.status +
          ')'
        )
      );
    }

    return data;
  }

async getTradeConfig({
  environment,
  accessToken,
  accNum
}) {
  if (
    accNum === null ||
    accNum === undefined ||
    isNaN(Number(accNum))
  ) {
    throw new Error(
      'accNum is missing or invalid; cannot query TradeLocker config.'
    );
  }

  const baseUrl = this.getBaseUrl(environment);

  const response = await fetch(
    baseUrl + '/trade/config',
    {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json',
        'accNum': String(accNum)
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      (
        'Failed to fetch TradeLocker config (' +
        response.status +
        ')'
      )
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
      'TradeLocker returned authentication data instead of config.'
    );
  }

  return data;
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

    const baseUrl = this.getBaseUrl(environment);

    const url =
      baseUrl +
      '/trade/accounts/' +
      encodeURIComponent(accountId) +
      '/state';

    const headers = {
      'Authorization': 'Bearer ' + accessToken,
      'Accept': 'application/json',
      'accNum': String(accNum)
    };

    const response = await fetch(
      url,
      {
        method: 'GET',
        headers: headers
      }
    );

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        (
          'Failed to fetch account state (' +
          response.status +
          ')'
        )
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

    const accountDetailsData =
      data &&
      data.d &&
      data.d.accountDetailsData;

    if (!Array.isArray(accountDetailsData)) {
      return {
        balance: null,
        equity: null,
        freeMargin: null,
        marginUsed: null,
        unrealizedPl: null
      };
    }

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

    return {
      balance: balance,

      equity: projectedBalance,

      freeMargin: availableFunds,

      marginUsed: initialMarginReq,

      unrealizedPl: openNetPnL
    };
  }
}

module.exports = {
  TradeLockerClient: TradeLockerClient
};
