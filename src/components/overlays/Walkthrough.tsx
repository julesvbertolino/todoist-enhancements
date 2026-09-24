import { useState } from 'react';
import { Overlay } from './Overlay';
import { Icon } from '../Icon';
import { AccentChoice, DensityChoice, ThemeChoice } from '../Choosers';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { markOnboarded } from '@/domain/onboarding';
import { useIsPhone } from '@/hooks/useTouchLayout';

/**
 * The first run, once, per account.
 *
 * One page, three choices, all of which already have a defensible answer set —
 * so this is a greeting that happens to be adjustable rather than a form
 * standing between somebody and their tasks. Nothing here has to be answered
 * for the app to work, and all three live in Settings afterwards.
 *
 * They are on one page rather than three because they are one decision: what
 * the thing should look like. Paging through them made a four-click ceremony
 * out of a question you can answer by glancing at it, and the shape of the
 * week — which is about how you work rather than how it looks — did not belong
 * in a first run at all. It is in Settings, where it is found when it is
 * wanted rather than asked before anyone knows what it means.
 *
 * Each choice takes effect the moment it is made, on the app behind the
 * dialog as well as inside it. That is the whole argument for doing this at
 * all: a colour named in a list is a guess, and a colour applied to the page
 * you are about to use is an answer.
 *
 * The settings are written immediately; the *record of having been asked* is
 * written by Start or by Skip. Closing the window means being asked again
 * rather than silently never being asked.
 *
 * On a phone it is one choice, not three. Three grids of cards on a 375px
 * screen is a page and a half of scrolling before anyone has seen a task —
 * which is a form standing between somebody and their work, the one thing
 * this was written not to be. Light or dark is worth asking because it is the
 * choice a phone gets wrong most often and the one nobody thinks to go
 * looking for; the accent and the density are a pleasure to find later, in
 * Settings, where both still are.
 */

export function Walkthrough({
  open, onDone,
}: { open: boolean; onDone: () => void }) {
  const { t } = useT();
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const user = useStore((s) => s.snapshot.user);
  const phone = useIsPhone();
  const [step, setStep] = useState(0);

  /* Finishing records the account and hands over to the tour. Skipping records
     it too and stops there: somebody who skipped the setup did not ask to be
     shown round either. */
  const finish = () => {
    markOnboarded(user?.id);
    // With the settings too, so the account's other browsers know.
    if (!prefs.onboarded) setPrefs({ onboarded: true });
    setStep(0);
    onDone();
  };

  return (
    <Overlay
      open={open}
      /* The scrim and Escape both land here. Leaving early is leaving, not
         finishing: it is not recorded, so the next launch asks again. */
      onClose={onDone}
      label={t('walkthrough.title')}
      size="md"
    >
      <div className="walkthrough">
        <div className="wt-head">
          <div>
            <h2>{t(step === 0 ? 'walkthrough.appearanceTitle' : 'walkthrough.organise')}</h2>
          </div>
          <button className="wt-skip" onClick={finish}>
            {t('walkthrough.skip')}
          </button>
        </div>

        <div className="wt-body">
          {step === 0 && (
            <>
              <section className="wt-appearance-row">
                <div>
                  <h3>{t('settings.density')}</h3>
                  <DensityChoice value={prefs.density} onChange={(value) => setPrefs({ density: value })} />
                </div>
                <div>
                  <h3>{t('settings.theme')}</h3>
                  <ThemeChoice value={prefs.theme} onChange={(value) => setPrefs({ theme: value })} />
                </div>
              </section>
              {!phone && (
                <section>
                  <h3>{t('settings.accent')}</h3>
                  <AccentChoice
                    value={prefs.accent}
                    custom={prefs.accentCustom}
                    onChange={(value) => setPrefs({ accent: value })}
                    onCustom={(value) => setPrefs({ accent: 'custom', accentCustom: value })}
                  />
                </section>
              )}
            </>
          )}

          {step === 1 && (
            <section className="wt-setup">
              <div className="wt-week-layouts">
                {(['unified', 'split'] as const).map((layout) => (
                  <button
                    key={layout}
                    className={prefs.weekLayout === layout ? 'selected' : undefined}
                    aria-pressed={prefs.weekLayout === layout}
                    onClick={() => setPrefs({ weekLayout: layout })}
                  >
                    <span className={`wt-week-visual ${layout}`} aria-hidden="true"><i /><i /></span>
                    <strong>{t(`walkthrough.weekLayout.${layout}`)}</strong>
                  </button>
                ))}
              </div>
              <button className={`wt-option${prefs.eisenhowerEnabled ? ' selected' : ''}`} onClick={() => setPrefs({ eisenhowerEnabled: !prefs.eisenhowerEnabled })}>
                <Icon name="dashboard" />
                <span><strong>{t('settings.eisenhower')}</strong><small>{t('settings.eisenhowerHint')}</small></span>
                <span className="switch" role="switch" aria-checked={prefs.eisenhowerEnabled} />
              </button>
              <button className={`wt-option${prefs.showQuickGroup ? ' selected' : ''}`} onClick={() => setPrefs({ showQuickGroup: !prefs.showQuickGroup })}>
                <Icon name="clock" />
                <span><strong>{t('settings.showQuick')}</strong><small>{t('settings.showQuickHint')}</small></span>
                <span className="switch" role="switch" aria-checked={prefs.showQuickGroup} />
              </button>
            </section>
          )}

        </div>

        <div className="wt-foot">
          <span>{t('walkthrough.step', { current: step + 1, total: 2 })}</span>
          {step > 0 && <button className="btn" onClick={() => setStep((at) => at - 1)}>{t('review.back')}</button>}
          <button className="btn primary" onClick={() => (step === 1 ? finish() : setStep(1))}>
            {step === 1 ? t('walkthrough.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
