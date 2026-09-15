/**
 * Persistent TradeLocker Session Manager
 *
 * Access token:
 *   RAM only
 *
 * Refresh token:
 *   PostgreSQL for session recovery
 *
 * Password:
 *   NEVER stored
 *
 * Tokens:
 *   NEVER logged
 */

class TradeLockerSessionManager {
  constructor({ db, client }) {
    if (typeof db !== 'function') {
      throw new Error(
        'TradeLockerSessionManager requires the PostgreSQL db helper.'
      );
    }

    if (!client) {
      throw new Error(
        'TradeLockerSessionManager requires the TradeLocker client.'
      );
    }

    this.db = db;
    this.client = client;
    this.sessions = new Map();
  }

  async setSession(
    userId,
    {
      environment,
      server,
      accessToken,
      refreshToken,
      accounts = [],
      selectedAccount = null,
      email = null
    }
  ) {
    const uid = Number(userId);

    this.sessions.set(uid, {
      environment,
      server,
      accessToken,
      refreshToken,
      accounts,
      selectedAccount,
      connectedAt: new Date().toISOString()
    });

    await this.db(
      `UPDATE tradelocker_connections
       SET
         environment = $1,
         server = $2,
         refresh_token = $3,
         email = COALESCE($4, email),
         selected_account_id = $5,
         selected_acc_num = $6,
         selected_account_name = $7,
         status = 'connected',
         last_error = NULL,
         last_connected_at = NOW(),
         token_updated_at = NOW(),
         updated_at = NOW()
       WHERE user_id = $8`,
      [
        environment,
        server,
        refreshToken,
        email,
        selectedAccount ? selectedAccount.id : null,
        selectedAccount ? selectedAccount.accNum : null,
        selectedAccount ? selectedAccount.accountName : null,
        uid
      ]
    );

    return this.sessions.get(uid);
  }

  getSession(userId) {
    return this.sessions.get(Number(userId)) || null;
  }

  async restoreSession(userId) {
    const uid = Number(userId);

    const existing = this.getSession(uid);

    if (existing && existing.accessToken) {
      return existing;
    }

    const { rows } = await this.db(
      `SELECT
         environment,
         server,
         refresh_token,
         email,
         selected_account_id,
         selected_acc_num,
         selected_account_name,
         account_id,
         acc_num,
         account_name,
         currency,
         status
       FROM tradelocker_connections
       WHERE user_id = $1
       LIMIT 1`,
      [uid]
    );

    const connection = rows[0];

    if (!connection) {
      return null;
    }

    if (!connection.refresh_token) {
      return null;
    }

    if (
      !connection.environment ||
      !connection.server
    ) {
      return null;
    }

    try {
      /*
       * Refresh the TradeLocker access token.
       *
       * IMPORTANT:
       * Tokens are intentionally never logged.
       */
      const refreshed =
        await this.client.refreshAccessToken({
          environment: connection.environment,
          refreshToken: connection.refresh_token
        });

      if (
        !refreshed ||
        !refreshed.accessToken
      ) {
        throw new Error(
          'TradeLocker token refresh did not return an access token.'
        );
      }

      const accounts =
        await this.client.getAllAccounts({
          environment: connection.environment,
          accessToken: refreshed.accessToken
        });

      if (!accounts || accounts.length === 0) {
        throw new Error(
          'TradeLocker session restored, but no trading accounts were found.'
        );
      }

      /*
       * Restore previously selected account.
       */
      let selectedAccount = null;

      if (connection.selected_account_id) {
        selectedAccount =
          accounts.find(
            account =>
              String(account.id) ===
              String(connection.selected_account_id)
          ) || null;
      }

      if (
        !selectedAccount &&
        connection.selected_acc_num !== null &&
        connection.selected_acc_num !== undefined
      ) {
        selectedAccount =
          accounts.find(
            account =>
              Number(account.accNum) ===
              Number(connection.selected_acc_num)
          ) || null;
      }

      /*
       * Backward-compatible fallback to the account
       * already stored in the connection table.
       */
      if (
        !selectedAccount &&
        connection.account_id
      ) {
        selectedAccount =
          accounts.find(
            account =>
              String(account.id) ===
              String(connection.account_id)
          ) || null;
      }

      /*
       * If there is only one account, select it automatically.
       */
      if (
        !selectedAccount &&
        accounts.length === 1
      ) {
        selectedAccount = accounts[0];
      }

      /*
       * If we still cannot identify an account,
       * keep the session connected but without a selection.
       */
      this.sessions.set(uid, {
        environment: connection.environment,
        server: connection.server,
        accessToken: refreshed.accessToken,
        refreshToken:
          refreshed.refreshToken ||
          connection.refresh_token,
        accounts,
        selectedAccount,
        connectedAt: new Date().toISOString()
      });

      /*
       * Save the potentially rotated refresh token
       * and restored account.
       */
      await this.db(
        `UPDATE tradelocker_connections
         SET
           refresh_token = $1,
           selected_account_id = $2,
           selected_acc_num = $3,
           selected_account_name = $4,
           account_id = COALESCE($2, account_id),
           acc_num = COALESCE($3, acc_num),
           account_name = COALESCE($4, account_name),
           currency = COALESCE($5, currency),
           status = 'connected',
           last_error = NULL,
           last_connected_at = NOW(),
           token_updated_at = NOW(),
           updated_at = NOW()
         WHERE user_id = $6`,
        [
          refreshed.refreshToken ||
            connection.refresh_token,

          selectedAccount
            ? selectedAccount.id
            : null,

          selectedAccount
            ? selectedAccount.accNum
            : null,

          selectedAccount
            ? selectedAccount.accountName
            : null,

          selectedAccount
            ? selectedAccount.currency
            : connection.currency,

          uid
        ]
      );

      return this.sessions.get(uid);

    } catch (error) {
      /*
       * Do not expose or log token values.
       */
      await this.db(
        `UPDATE tradelocker_connections
         SET
           status = 'error',
           last_error = $1,
           updated_at = NOW()
         WHERE user_id = $2`,
        [
          error.message ||
            'TradeLocker session restoration failed.',
          uid
        ]
      ).catch(() => {});

      return null;
    }
  }

  async updateSelectedAccount(userId, account) {
    const uid = Number(userId);

    const session =
      this.sessions.get(uid);

    if (!session) {
      return false;
    }

    session.selectedAccount = account;

    await this.db(
      `UPDATE tradelocker_connections
       SET
         selected_account_id = $1,
         selected_acc_num = $2,
         selected_account_name = $3,
         account_id = $1,
         acc_num = $2,
         account_name = $3,
         currency = $4,
         status = 'connected',
         last_error = NULL,
         updated_at = NOW()
       WHERE user_id = $5`,
      [
        account ? account.id : null,
        account ? account.accNum : null,
        account ? account.accountName : null,
        account ? account.currency : null,
        uid
      ]
    );

    return true;
  }

  async clearSession(userId) {
    const uid = Number(userId);

    const deleted =
      this.sessions.delete(uid);

    await this.db(
      `UPDATE tradelocker_connections
       SET
         status = 'disconnected',
         refresh_token = NULL,
         selected_account_id = NULL,
         selected_acc_num = NULL,
         selected_account_name = NULL,
         updated_at = NOW()
       WHERE user_id = $1`,
      [uid]
    ).catch(() => {});

    return deleted;
  }

  hasActiveSession(userId) {
    const session =
      this.sessions.get(Number(userId));

    return Boolean(
      session &&
      session.accessToken
    );
  }
}

module.exports = {
  TradeLockerSessionManager
};
