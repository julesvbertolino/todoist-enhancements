import { forgetCredentials, freshAccessToken, readCredentials } from './oauth';

/**
 * Where the credential comes from.
 *
 * Two ways in. Signing in with Todoist (OAuth, see oauth.ts) is the one the
 * connect screen offers first: nothing to copy, and the app shows up in the
 * person's Todoist integrations where it can be revoked. A personal API token
 * pasted by hand still works, for anyone who prefers it. Either way the rest
 * of the app only ever asks this file for "the token to send".
 */

const TOKEN_KEY = 'tde.token';

export interface AuthProvider {
  /** The bearer token to send, or null when the app is not connected. */
  getToken(): Promise<string | null>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

class Auth implements AuthProvider {
  private token: string | null;

  constructor() {
    this.token = readStoredToken();
  }

  /** True when the connection came from signing in, not from a pasted token. */
  get viaOAuth(): boolean {
    return !this.token && readCredentials() !== null;
  }

  async getToken(): Promise<string | null> {
    if (this.token) return this.token;
    return freshAccessToken();
  }

  /**
   * After a 401, one more try with a renewed access token — an hour can end
   * between the check and the request. Null when there is nothing to renew.
   */
  async renewAfterRefusal(): Promise<string | null> {
    return this.viaOAuth ? freshAccessToken(true) : null;
  }

  isConnected(): boolean {
    return (this.token !== null && this.token.length > 0) || readCredentials() !== null;
  }

  async set(token: string): Promise<void> {
    this.token = token.trim();
    forgetCredentials();
    try {
      localStorage.setItem(TOKEN_KEY, this.token);
    } catch {
      // A browser with storage blocked still works for the session in memory.
    }
  }

  /**
   * Forgets the credential on this device. An OAuth grant stays listed in
   * Todoist's own integrations settings until it is removed there: revoking
   * it from here would need a client secret, which a page cannot keep.
   */
  async disconnect(): Promise<void> {
    this.token = null;
    forgetCredentials();
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const auth = new Auth();

/** Rejects anything that cannot be a Todoist personal token before a call is made. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
