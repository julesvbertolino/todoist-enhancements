import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { AccentChoice, DensityChoice, ThemeChoice } from '@/components/Choosers';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { avatarUrl } from '@/domain/colors';
import { formatDuration, parseDurationInput } from '@/domain/estimates';
import { defaultCapacity, weeklyCapacity, type DailyCapacity } from '@/domain/load';
import { DATE_FORMATS, formatDay, type DateFormat } from '@/domain/dates';
import { HOME_VIEWS, WEEK_LAYOUTS, type HomeView, type WeekLayout } from '@/store/prefs';
import { DEFAULT_WEEK_LABEL } from '@/domain/types';
import type { Locale, TranslationKey } from '@/i18n';
import { APP_NAME, AUTHOR, AUTHOR_AVATAR_URL, COFFEE_URL, GITHUB_URL, SITE_URL, VERSION } from '@/app-info';
import { karmaStanding } from '@/domain/karma';

const SECTIONS = ['account', 'general', 'features', 'appearance', 'conflicts', 'about'] as const;

/** A date with two digits in the day and a month that is short in both
 *  languages, so every option in the list is the same length. */
const SAMPLE_DATE = new Date(2026, 8, 12);
type Section = (typeof SECTIONS)[number];

/**
 * Settings.
 *
 * One page that scrolls, rather than four that swap: every setting is
 * reachable by reading downwards, and the menu marks where you are instead of
 * deciding what you may see.
 */
export function SettingsView() {
  const { t, locale } = useT();
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setLocale = useStore((s) => s.setLocale);
  const disconnect = useStore((s) => s.disconnect);
  const user = useStore((s) => s.snapshot.user);
  const karma = karmaStanding(user?.karma);
  const calloutKey = `coffee-callout:${user?.id ?? 'anonymous'}`;
  const [showCoffeeCallout, setShowCoffeeCallout] = useState(
    () => localStorage.getItem(calloutKey) !== 'dismissed',
  );

  const current = useCurrentSection();
  const avatar = avatarUrl(user);
  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB';

  /* Monday-first labels. 8 January 2024 was a Monday; the capacity array is
     indexed Sunday-first, so the two are mapped rather than assumed equal. */
  const dayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(intl, { weekday: 'short' }).format(new Date(2024, 0, 8 + i)),
  );

  const setDayCapacity = (index: number, raw: string) => {
    const minutes = parseDurationInput(raw);
    if (minutes === null) return;
    const next = [...prefs.dailyCapacity] as DailyCapacity;
    next[index] = minutes;
    setPrefs({ dailyCapacity: next });
  };

  const toggle = (key: keyof typeof prefs.conflicts) =>
    setPrefs({ conflicts: { ...prefs.conflicts, [key]: !prefs.conflicts[key] } });

  const weekly = weeklyCapacity(prefs.dailyCapacity, prefs.weeklyCapacityOverride);

  return (
    <div className="page wide">
      <div className="phead">
        <div>
          <h1 className="ptitle">{t('settings.title')}</h1>
        </div>
      </div>

      <div className="settings">
        {/* The menu navigates the page rather than replacing it, so these are
            links to anchors — Back works, and a section can be shared. */}
        <nav className="setnav" aria-label={t('settings.sections')}>
          {SECTIONS.map((section) => (
            <a
              key={section}
              href={`#/settings#${section}`}
              aria-current={current === section}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {t(`settings.${section}` as TranslationKey)}
            </a>
          ))}
        </nav>

        <div className="setbody">
          {/* ---------------------------------------------------- Account */}
          <section className="setsection" id="account">
            <h2>{t('settings.account')}</h2>

            <div className="setrow account">
              <span className="setavatar">
                {avatar
                  ? <img src={avatar} alt="" width={56} height={56} referrerPolicy="no-referrer" />
                  : <span>{(user?.full_name ?? '?').slice(0, 1).toUpperCase()}</span>}
              </span>
              <div>
                <strong>{user?.full_name ?? '—'}</strong>
                <span>{user?.email ?? t('settings.connected')}</span>
              </div>
              <button className="btn outline" onClick={() => void disconnect()}>
                <Icon name="logout" size="sm" />
                {t('settings.disconnect')}
              </button>
            </div>
            <p className="sethint">{t('settings.disconnectHint')}</p>
            {karma && (
              <div className="karma-detail">
                <div className="karma-scale">
                  <span className="karma-progress" aria-label={`${karma.progress}%`}>
                    <i style={{ width: `${karma.progress}%` }} />
                    <small>{karma.rank.from.toLocaleString(intl)}</small>
                    <strong>
                      {t(`karma.${karma.rank.key}` as TranslationKey)} ·{' '}
                      {karma.karma.toLocaleString(intl)}/{karma.rank.to?.toLocaleString(intl) ?? '∞'}
                    </strong>
                    <small>{karma.rank.to?.toLocaleString(intl) ?? '∞'}</small>
                  </span>
                </div>
                {karma.remaining !== null && karma.next && (
                  <p>{t('settings.karmaRemaining', {
                    remaining: karma.remaining,
                    next: t(`karma.${karma.next.key}` as TranslationKey),
                  })}</p>
                )}
              </div>
            )}
          </section>

          {showCoffeeCallout && (
            <aside className="coffee-callout">
              <img className="coffee-callout-avatar" src={AUTHOR_AVATAR_URL} alt="Jules-Valentin Bertolino" referrerPolicy="no-referrer" />
              <div>
                <strong>{t('settings.coffeeCalloutTitle')}</strong>
                <span>{t('settings.coffeeCalloutBody')}</span>
                <a className="btn" href={COFFEE_URL} target="_blank" rel="noreferrer noopener">
                  {t('settings.coffeeCalloutAction')}
                </a>
              </div>
              <button
                className="coffee-callout-close"
                aria-label={t('common.close')}
                onClick={() => {
                  localStorage.setItem(calloutKey, 'dismissed');
                  setShowCoffeeCallout(false);
                }}
              ><Icon name="close" size="sm" /></button>
            </aside>
          )}

          {/* ---------------------------------------------------- General */}
          <section className="setsection" id="general">
            <h2>{t('settings.general')}</h2>

            <Row title={t('settings.language')} hint={t('settings.languageHint')}>
              <Select
                value={prefs.locale}
                onChange={(value) => setLocale(value as Locale)}
                ariaLabel={t('settings.language')}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'fr', label: 'Français' },
                ]}
              />
            </Row>

            <Row title={t('settings.timeFormat')} hint={t('settings.timeFormatHint')}>
              <Select
                value={prefs.hour12 ? '12' : '24'}
                onChange={(value) => setPrefs({ hour12: value === '12' })}
                ariaLabel={t('settings.timeFormat')}
                options={[
                  { value: '24', label: t('settings.time24') },
                  { value: '12', label: t('settings.time12') },
                ]}
              />
            </Row>

            <Row title={t('settings.dateFormat')} hint={t('settings.dateFormatHint')}>
              <Select
                value={prefs.dateFormat}
                onChange={(value) => setPrefs({ dateFormat: value as DateFormat })}
                ariaLabel={t('settings.dateFormat')}
                options={DATE_FORMATS.map((format) => ({
                  value: format,
                  /* The sample is the label: naming the orders "day, month,
                     year" explains less than showing one. */
                  label: formatDay(SAMPLE_DATE, locale, format),
                }))}
              />
            </Row>

            {/* Read from the account, so it is stated rather than offered. */}
            <Row title={t('settings.weekStart')} hint={t('settings.weekStartHint')}>
              <span className="setvalue">{dayNames[((user?.start_day ?? 1) + 6) % 7]}</span>
            </Row>
          </section>

          {/* Settings that shape the product rather than its formatting. */}
          <section className="setsection" id="features">
            <h2>{t('settings.features')}</h2>
            <Row title={t('settings.homepage')} hint={t('settings.homepageHint')}>
              <Select
                value={prefs.homepage}
                onChange={(value) => setPrefs({ homepage: value as HomeView })}
                ariaLabel={t('settings.homepage')}
                options={HOME_VIEWS.map((view) => ({ value: view, label: t(`nav.${view}` as TranslationKey) }))}
              />
            </Row>
            <Row title={t('settings.naturalDates')} hint={t('settings.naturalDatesHint')}>
              <Switch checked={prefs.naturalDates} onChange={() => setPrefs({ naturalDates: !prefs.naturalDates })} label={t('settings.naturalDates')} />
            </Row>
            <Row title={t('settings.searchSections')} hint={t('settings.searchSectionsHint')}>
              <Switch checked={prefs.includeSectionsInSearch} onChange={() => setPrefs({ includeSectionsInSearch: !prefs.includeSectionsInSearch })} label={t('settings.searchSections')} />
            </Row>
            <Row title={t('settings.eisenhower')} hint={t('settings.eisenhowerHint')}>
              <Switch checked={prefs.eisenhowerEnabled} onChange={() => setPrefs({ eisenhowerEnabled: !prefs.eisenhowerEnabled })} label={t('settings.eisenhower')} />
            </Row>
            <h3 className="setsubhead">{t('settings.week')}</h3>

            <Row title={t('settings.perDayCapacity')} hint={t('settings.dailyCapacityHint')} />
            <div className="capgrid">
              {dayNames.map((name, index) => {
                // The array is indexed Sunday-first; the labels start on Monday.
                const dayIndex = (index + 1) % 7;
                return (
                  <label className="capday" key={name}>
                    <span>{name}</span>
                    <input
                      defaultValue={String(prefs.dailyCapacity[dayIndex])}
                      onBlur={(event) => setDayCapacity(dayIndex, event.target.value)}
                      aria-label={name}
                    />
                  </label>
                );
              })}
            </div>

            <Row title={t('settings.weeklySource')} hint={formatDuration(weekly, locale)}>
              <Select
                value={prefs.weeklyCapacityOverride === null ? 'days' : 'custom'}
                onChange={(value) =>
                  setPrefs({ weeklyCapacityOverride: value === 'days' ? null : weekly })}
                ariaLabel={t('settings.weeklySource')}
                options={[
                  { value: 'days', label: t('settings.weeklyFromDays') },
                  { value: 'custom', label: t('settings.weeklyCustom') },
                ]}
              />
            </Row>

            {prefs.weeklyCapacityOverride !== null && (
              <Row title={t('settings.weeklyValue')} hint={t('settings.weeklyOverride')}>
                <input
                  className="estinput"
                  defaultValue={String(prefs.weeklyCapacityOverride)}
                  onBlur={(event) => {
                    const minutes = parseDurationInput(event.target.value);
                    if (minutes !== null) setPrefs({ weeklyCapacityOverride: minutes });
                  }}
                  aria-label={t('settings.weeklyValue')}
                />
              </Row>
            )}

            <Row title={t('settings.weekLayout')} hint={t('settings.weekLayoutHint')}>
              <Select
                value={prefs.weekLayout}
                onChange={(value) => setPrefs({ weekLayout: value as WeekLayout })}
                ariaLabel={t('settings.weekLayout')}
                options={WEEK_LAYOUTS.map((layout) => ({
                  value: layout,
                  label: t(`settings.weekLayout.${layout}` as TranslationKey),
                }))}
              />
            </Row>

            {/* The tag is a name on the user's own board, not a setting this
                app invented, so it is typed rather than chosen from a list:
                the tag it should read may not exist here yet. */}
            <Row title={t('settings.weekLabel')} hint={t('settings.weekLabelHint')}>
              <input
                className="estinput"
                defaultValue={prefs.weekLabel}
                aria-label={t('settings.weekLabel')}
                onBlur={(event) => {
                  const next = event.target.value.trim().replace(/^@/, '');
                  setPrefs({ weekLabel: next || DEFAULT_WEEK_LABEL });
                  event.target.value = next || DEFAULT_WEEK_LABEL;
                }}
              />
            </Row>

            <Row title={t('settings.showQuick')} hint={t('settings.showQuickHint')}>
              <Switch
                checked={prefs.showQuickGroup}
                onChange={() => setPrefs({ showQuickGroup: !prefs.showQuickGroup })}
                label={t('settings.showQuick')}
              />
            </Row>

            <Row title={t('settings.quietAfter')} hint={t('settings.quietAfterHint')}>
              <span className="setunit">
                <input
                  className="estinput"
                  inputMode="numeric"
                  defaultValue={String(prefs.quietAfterDays)}
                  aria-label={t('settings.quietAfter')}
                  onBlur={(event) => {
                    const days = Number.parseInt(event.target.value, 10);
                    const next = Number.isFinite(days) && days > 0 ? days : prefs.quietAfterDays;
                    setPrefs({ quietAfterDays: next });
                    event.target.value = String(next);
                  }}
                />
                <span>{t('settings.days')}</span>
              </span>
            </Row>

            <Row title={t('settings.capacityDefaults')} hint={t('settings.capacityDefaultsHint')}>
              <button
                className="btn"
                onClick={() =>
                  setPrefs({ dailyCapacity: defaultCapacity(), weeklyCapacityOverride: null })}
              >
                {t('settings.restore')}
              </button>
            </Row>
          </section>

          {/* ------------------------------------------------ Appearance */}
          <section className="setsection" id="appearance">
            <h2>{t('settings.appearance')}</h2>
            <Row title={t('settings.theme')} hint={t('settings.themeHint')} wide>
              <ThemeChoice value={prefs.theme} onChange={(value) => setPrefs({ theme: value })} />
            </Row>
            <Row title={t('settings.accent')} hint={t('settings.accentHint')} wide>
              <AccentChoice
                value={prefs.accent}
                custom={prefs.accentCustom}
                onChange={(value) => setPrefs({ accent: value })}
                onCustom={(value) => setPrefs({ accent: 'custom', accentCustom: value })}
              />
            </Row>
            <Row title={t('settings.density')} hint={t('settings.densityHint')} wide>
              <DensityChoice value={prefs.density} onChange={(value) => setPrefs({ density: value })} />
            </Row>
          </section>

          {/* ------------------------------------------------- Conflicts */}
          <section className="setsection" id="conflicts">
            <h2>{t('settings.conflicts')}</h2>
            {(
              [
                ['dateAndWeek', 'settings.conflictDateWeek', 'settings.conflictDateWeekHint'],
                ['multipleEstimates', 'settings.conflictMultiple', 'settings.conflictMultipleHint'],
                ['quickTooLong', 'settings.conflictQuick', 'settings.conflictQuickHint'],
                ['parentAndChildren', 'settings.conflictParent', 'settings.conflictParentHint'],
                ['invalidEstimate', 'settings.conflictInvalid', 'settings.conflictInvalidHint'],
              ] as const
            ).map(([key, title, hint]) => (
              <Row key={key} title={t(title)} hint={t(hint)}>
                <Switch
                  checked={prefs.conflicts[key]}
                  onChange={() => toggle(key)}
                  label={t(title)}
                />
              </Row>
            ))}
          </section>

          {/* Todoist asks a third-party app to say, in its description, that
              it is not one of theirs. The sign-in screen carries that line
              for anyone who has not connected yet; this carries it for
              everyone who has. */}
          <section className="setsection last" id="about">
            <h2>{t('settings.about')}</h2>
            <div className="setrow">
              <div>
                <strong>{APP_NAME}</strong>
                <span>{t('connect.version', { version: VERSION })}</span>
              </div>
            </div>

            <Row title={t('settings.replayWalkthrough')} hint={t('settings.replayWalkthroughHint')}>
              <button className="btn outline" onClick={() => window.dispatchEvent(new Event('enhanced:replay-onboarding'))}>
                {t('settings.replayWalkthroughAction')}
              </button>
            </Row>
            <p className="setlegal">
              {t('connect.legal', { author: AUTHOR })}
            </p>
            <div className="setlinks">
              <a href={SITE_URL} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size="sm" />
                {t('settings.aboutSite')}
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size="sm" />
                {t('settings.aboutCode')}
              </a>
              <a href={`${GITHUB_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size="sm" />
                {t('settings.aboutChangelog')}
              </a>
              <a href={COFFEE_URL} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size="sm" />
                {t('settings.aboutCoffee')}
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Row({
  title, hint, children, wide,
}: { title: string; hint?: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`setrow${wide ? ' setrow-wide' : ''}`}>
      <div>
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </div>
  );
}






function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    />
  );
}

/**
 * Which section the reader is currently in.
 *
 * The last heading to have passed the top of the page wins. An observer band
 * was the first attempt and it has a hole in it: a section taller than the
 * band leaves no heading inside it, and the menu stops moving.
 */
function useCurrentSection(): Section {
  const [current, setCurrent] = useState<Section>(SECTIONS[0]);

  useEffect(() => {
    const scroller = document.querySelector('.screen.active') ?? window;

    const read = () => {
      let found: Section = SECTIONS[0];
      for (const section of SECTIONS) {
        const node = document.getElementById(section);
        if (node && node.getBoundingClientRect().top <= 140) found = section;
      }
      setCurrent(found);
    };

    read();
    scroller.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      scroller.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  return current;
}
