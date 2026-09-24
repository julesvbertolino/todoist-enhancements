import { SITE_URL } from '@/app-info';

/**
 * Signing in with Todoist, without a server.
 *
 * Todoist accepts a "Client ID Metadata Document": the client id is the URL
 * of a small JSON file this site hosts (public/oauth/client.json), which
 * names the app and the addresses it may return to. There is no registration
 * and no secret — the app proves the round trip is its own with PKCE instead,
 * which is exactly what a page with no server needs. Todoist answers the
 * token exchange from the browser (it sends CORS headers for this origin).
 *
 * What comes back is an access token that lasts an hour and a refresh token
 * that gets a new one. The refresh token rotates on every use, so it is kept
 * where every tab reads it and renewed under a lock, one tab at a time.
 */

export const OAUTH_CLIENT_ID = `${SITE_URL}/oauth/client.json`;
const AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize';
const TOKEN_URL = 'https://api.todoist.com/oauth/access_token';
/** Read and write, delete tasks, and delete projects — everything the app does. */
const SCOPE = 'data:read_write,data:delete,project:delete';

const CREDENTIALS_KEY = 'tde.oauth';
const PENDING_KEY = 'tde.oauth.pending';
/** Renew a little before the hour is up rather than on the first refusal. */
const RENEW_MARGIN_MS = 60_000;

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/* ---------- Storage ---------- */

export function readCredentials(): OAuthCredentials | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    return raw ? (JSON.parse(raw) as OAuthCredentials) : null;
  } catch {
    return null;
  }
}

function writeCredentials(credentials: OAuthCredentials | null): void {
  try {
    if (credentials) localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    else localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    /* storage blocked: the session keeps working from memory in auth.ts */
  }
}

export const forgetCredentials = (): void => writeCredentials(null);

function fromResponse(body: TokenResponse, previous: OAuthCredentials | null): OAuthCredentials {
  return {
    accessToken: body.access_token,
    // Rotated on every refresh; kept as it was if an answer ever omits it.
    refreshToken: body.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/* ---------- PKCE ---------- */

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 48): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Where Todoist sends the person back: this page, without its route or query. */
function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/* ---------- The round trip ---------- */

/** Leaves for Todoist's consent page. The page is gone after this. */
export async function beginSignIn(): Promise<void> {
  const verifier = randomString(64);
  const state = randomString(24);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({
    verifier, state, redirectUri: redirectUri(), route: window.location.hash,
  }));
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('code_challenge', await challengeOf(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.toString());
}

export type SignInResult = 'none' | 'signed-in' | 'denied' | 'failed';

/**
 * Finishes a sign-in if this page load is Todoist sending the person back.
 *
 * Returns 'none' on an ordinary load. The code and state are taken out of the
 * address bar either way, so a reload or a shared link never replays them.
 */
export async function completeSignIn(): Promise<SignInResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return 'none';

  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  const pending = pendingRaw
    ? (JSON.parse(pendingRaw) as { verifier: string; state: string; redirectUri: string; route: string })
    : null;
  window.history.replaceState(null, '', `${window.location.pathname}${pending?.route ?? ''}`);

  if (error) return error === 'access_denied' ? 'denied' : 'failed';
  // No pending sign-in, or not ours: never exchange a code this tab did not ask for.
  if (!pending || params.get('state') !== pending.state) return 'failed';

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'authorization_code',
        code: code!,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      }).toString(),
    });
    const body = (await response.json()) as TokenResponse;
    if (!response.ok || !body.access_token) return 'failed';
    writeCredentials(fromResponse(body, null));
    return 'signed-in';
  } catch {
    return 'failed';
  }
}

/* ---------- Renewing ---------- */

let renewing: Promise<OAuthCredentials | null> | null = null;

async function renewNow(): Promise<OAuthCredentials | null> {
  // Another tab may have renewed while this one waited for the lock.
  const current = readCredentials();
  if (!current?.refreshToken) return current;
  if (current.expiresAt - Date.now() > RENEW_MARGIN_MS) return current;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    }).toString(),
  });
  if (response.status === 400 || response.status === 401) {
    // The refresh token was revoked or has expired: signing in again is the only way.
    writeCredentials(null);
    return null;
  }
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
  const next = fromResponse((await response.json()) as TokenResponse, current);
  writeCredentials(next);
  return next;
}

/**
 * An access token that is good for at least another minute, renewed if not.
 *
 * Returns null when the sign-in is over (no credentials, or a refresh token
 * Todoist no longer accepts). Throws on a network failure, which the caller
 * treats like any other: offline, try again later.
 */
export async function freshAccessToken(force = false): Promise<string | null> {
  let credentials = readCredentials();
  if (!credentials) return null;
  if (force) {
    credentials = { ...credentials, expiresAt: 0 };
    writeCredentials(credentials);
  }
  if (credentials.expiresAt - Date.now() > RENEW_MARGIN_MS) return credentials.accessToken;
  if (!credentials.refreshToken) return credentials.accessToken;

  if (!renewing) {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    /* Held across tabs: two tabs renewing at once would each spend the same
       rotating refresh token, and the second would be refused. */
    const run = locks
      ? new Promise<OAuthCredentials | null>((resolve, reject) => {
        void locks.request('tde-oauth-renew', () => renewNow().then(resolve, reject));
      })
      : renewNow();
    renewing = run.finally(() => { renewing = null; });
  }
  const renewed = await renewing;
  return renewed?.accessToken ?? null;
}
