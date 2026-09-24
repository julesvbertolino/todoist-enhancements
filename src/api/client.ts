import { auth } from './auth';

export const API_BASE = 'https://api.todoist.com/api/v1';

/** What Todoist puts in the body of a refusal. */
interface TodoistErrorBody {
  error?: string;
  error_tag?: string;
  error_code?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  private get parsedBody(): TodoistErrorBody {
    return (this.body && typeof this.body === 'object' ? this.body : {}) as TodoistErrorBody;
  }

  /**
   * The token is missing, wrong, or has been revoked.
   *
   * 401 always means that. 403 does not: Todoist also answers 403 when a
   * command is against the rules of the account's plan, and reading that as a
   * bad token both hid the real reason and signed the user out over it. A 403
   * only counts as an auth failure when the body says so.
   */
  get isAuthError(): boolean {
    if (this.status === 401) return true;
    if (this.status !== 403) return false;
    const tag = `${this.parsedBody.error_tag ?? ''} ${this.parsedBody.error ?? ''}`.toLowerCase();
    return /auth|token|permission|forbidden/.test(tag) || tag.trim() === '';
  }

  /**
   * Todoist has refused this and will refuse it again.
   *
   * A refusal is a fact about the request, not about the network, so the
   * change must be rolled back and the command dropped rather than queued to
   * be retried for ever.
   */
  get isRefusal(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429 && !this.isAuthError;
  }

  /** What Todoist actually said, for showing to the person who asked. */
  get detail(): string {
    const { error, error_tag: tag } = this.parsedBody;
    if (error) return error;
    if (typeof this.body === 'string' && this.body.trim()) return this.body.trim();
    if (tag) return tag.replace(/_/g, ' ').toLowerCase();
    return this.message;
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('No Todoist token is configured.');
    this.name = 'NotConnectedError';
  }
}

/**
 * A request that has not answered in this long is treated as a lost network.
 *
 * `fetch` has no limit of its own, and a stalled connection — a captive
 * portal, a laptop waking up, a phone changing networks — can hang for
 * minutes or for ever. While it hangs no other sync starts, so the app sat on
 * "syncing" until it was reloaded.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Thrown when Todoist did not answer in time. Handled like being offline. */
export class TimeoutError extends Error {
  constructor() {
    super('Todoist did not answer in time.');
    this.name = 'TimeoutError';
  }
}

/** The caller's signal and a deadline, as one signal, on browsers without `AbortSignal.any`. */
function withDeadline(signal: AbortSignal | undefined, ms: number): {
  signal: AbortSignal; timedOut: () => boolean; done: () => void;
} {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, ms);
  const forward = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Sent as a form body, which is what the sync endpoint expects. */
  form?: Record<string, string>;
  json?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** How many times to retry on 429 or a 5xx. */
  retries?: number;
  /** How long to wait for an answer; the first full sync of a big account needs longer. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One call to Todoist.
 *
 * Honours the `retry_after` the API sends with a 429 rather than guessing, and
 * backs off on server errors. Auth failures are never retried: the token is
 * wrong and trying again cannot fix it.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let token = await auth.getToken();
  if (!token) throw new NotConnectedError();
  let renewed = false;

  const {
    method = 'GET', form, json, query, signal, retries = 3, timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;

  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  let attempt = 0;
  for (;;) {
    /* The deadline covers the whole answer, body included: a response that
       starts and then stalls is as stuck as one that never starts. */
    const deadline = withDeadline(signal, timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method, headers: { ...headers, Authorization: `Bearer ${token}` }, body,
        signal: deadline.signal,
      });
      text = await response.text().catch(() => '');
    } catch (error) {
      if (deadline.timedOut()) throw new TimeoutError();
      throw error;
    } finally {
      deadline.done();
    }

    /* A signed-in access token lasts an hour; one that ran out between the
       check and the request is renewed once and the request tried again. */
    if (response.status === 401 && !renewed) {
      renewed = true;
      const next = await auth.renewAfterRefusal();
      if (next) {
        token = next;
        continue;
      }
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (text ? JSON.parse(text) : undefined) as T;
    }

    const retriable = response.status === 429 || response.status >= 500;
    if (!retriable || attempt >= retries) {
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      throw new ApiError(
        `Todoist responded ${response.status}`,
        response.status,
        parsed,
      );
    }

    // The API tells us how long to wait; fall back to exponential backoff.
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 2 ** attempt * 1000);

    await sleep(waitMs);
    attempt += 1;
  }
}
