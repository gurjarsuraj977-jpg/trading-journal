/**
 * In-Memory TradeLocker Session Store
 * STRICT SECURITY: Access and refresh tokens live ONLY in RAM.
 * When Node restarts, RAM sessions are wiped, enforcing 'reconnect_required'.
 */

class TradeLockerSessionManager {
  constructor() {
    this.sessions = new Map(); // Map<userId, SessionObject>
  }

  setSession(userId, { environment, server, accessToken, refreshToken, accounts = [], selectedAccount = null }) {
    this.sessions.set(Number(userId), {
      environment,
      server,
      accessToken,
      refreshToken,
      accounts,
      selectedAccount, // { id, accNum, accountName, currency }
      connectedAt: new Date().toISOString()
    });
  }

  getSession(userId) {
    return this.sessions.get(Number(userId)) || null;
  }

  updateSelectedAccount(userId, account) {
    const session = this.sessions.get(Number(userId));
    if (!session) return false;
    session.selectedAccount = account;
    return true;
  }

  clearSession(userId) {
    return this.sessions.delete(Number(userId));
  }

  hasActiveSession(userId) {
    const session = this.sessions.get(Number(userId));
    return Boolean(session && session.accessToken);
  }
}

module.exports = { TradeLockerSessionManager };
