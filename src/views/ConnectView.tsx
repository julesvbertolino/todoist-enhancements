import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { looksLikeToken } from '@/api/auth';
import { beginSignIn, builtForElsewhere } from '@/api/oauth';
import { AUTHOR, GITHUB_URL, TODOIST_DEVELOPER_URL, VERSION } from '@/app-info';


/**
 * The first screen: connecting the account.
 *
 * Signing in with Todoist comes first: one button, Todoist's own consent
 * page, and back here connected, with nothing to find or copy. A personal
 * API token still works, one click further down, for anyone who prefers it.
 * Whatever the way in, the credential stays on the device and goes nowhere
 * but Todoist, which is why the privacy note sits right under the buttons.
 */
export function ConnectView() {
  const { t } = useT();
  const connect = useStore((s) => s.connect);
  const startDemo = useStore((s) => s.startDemo);
  const setLocale = useStore((s) => s.setLocale);
  const locale = useStore((s) => s.prefs.locale);

  const signInError = useStore((s) => s.signInError);

  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'invalid' | 'malformed'>('idle');
  const [leaving, setLeaving] = useState(false);
  /** The address this copy was built for, once a sign-in has been refused for it. */
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  // The token route opens by itself when it is what failed, or what the sign-in fell back to.
  const [tokenOpen, setTokenOpen] = useState(signInError === 'failed');

  async function submit() {
    if (!looksLikeToken(token)) {
      setStatus('malformed');
      return;
    }
    setStatus('checking');
    const ok = await connect(token);
    if (!ok) setStatus('invalid');
  }

  const legal = t('connect.legal', { author: AUTHOR }).split(AUTHOR);

  return (
    <div className="connect">
      <div className="connect-card">
        <div className="connect-head">
          <h1>{t('connect.appName')}</h1>
          <span className="connect-version">{t('connect.version', { version: VERSION })}</span>
        </div>
        <p className="connect-intro">{t('connect.intro')}</p>

        <button
          className="btn primary lg connect-submit"
          disabled={leaving}
          onClick={() => {
            const expected = builtForElsewhere();
            if (expected) { setElsewhere(expected); setTokenOpen(true); return; }
            setLeaving(true);
            void beginSignIn();
          }}
        >
          {leaving ? t('connect.oauthLeaving') : t('connect.oauth')}
        </button>
        {signInError === 'denied' && <p className="connect-error">{t('connect.oauthDenied')}</p>}
        {signInError === 'failed' && <p className="connect-error">{t('connect.oauthFailed')}</p>}
        {elsewhere && (
          <p className="connect-error">
            {t('connect.oauthElsewhere', {
              expected: elsewhere,
              here: `${window.location.origin}${window.location.pathname}`,
            })}
          </p>
        )}

        <button className="btn tint lg connect-demo" onClick={startDemo}>
          <Icon name="bars" size="sm" />
          {t('connect.demoInstead')}
        </button>

        <p className="connect-privacy">
          <strong>{t('connect.privacyLead')}</strong>{' '}
          {t('connect.privacyBody')}{' '}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size="sm" />
            {t('connect.github')}
          </a>
        </p>

        <details
          className="connect-token"
          open={tokenOpen}
          onToggle={(e) => setTokenOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{t('connect.useToken')}</summary>

          <label className="sr" htmlFor="token">{t('connect.tokenLabel')}</label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('connect.tokenPlaceholder')}
            value={token}
            onChange={(e) => { setToken(e.target.value); setStatus('idle'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />

          {status === 'invalid' && <p className="connect-error">{t('connect.invalid')}</p>}
          {status === 'malformed' && <p className="connect-error">{t('connect.malformed')}</p>}

          <button
            className="btn lg connect-token-submit"
            disabled={status === 'checking'}
            onClick={() => void submit()}
          >
            {status === 'checking' ? t('connect.checking') : t('connect.submit')}
          </button>

          <a
            className="connect-apikey"
            href={TODOIST_DEVELOPER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('connect.apiKey')}
          </a>
        </details>

        <div className="connect-langs">
          {(['en', 'fr'] as const).map((value) => (
            <button
              key={value}
              className={`btn sm${locale === value ? ' primary' : ''}`}
              onClick={() => setLocale(value)}
            >
              {value === 'en' ? 'English' : 'Français'}
            </button>
          ))}
        </div>
      </div>

      {/* Outside the card, on the gradient: this is about the project, not
          about signing in. */}
      <p className="connect-legal">
        {legal[0]}<strong>{AUTHOR}</strong>{legal[1]}
      </p>
    </div>
  );
}
