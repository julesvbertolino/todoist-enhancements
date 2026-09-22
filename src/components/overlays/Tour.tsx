import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { useT } from '@/hooks/useT';
import type { TranslationKey } from '@/i18n';

/**
 * The tour: a few things worth pointing at, pointed at.
 *
 * Not a dialog describing features — the app itself, with one part of it lit
 * and the rest dimmed. Every stop names a real element by `data-tour`, and the
 * element is measured where it actually is rather than drawn again here, so
 * what is being explained is the thing you will be using.
 *
 * A stop whose element is not on the page is skipped rather than shown
 * pointing at nothing. That is what makes this safe to run against somebody's
 * own week on their first connection: an empty week simply gives a shorter
 * tour, and nobody is shown a highlight over an empty patch of page.
 *
 * Nothing here can be interacted with. The dim layer takes every click, so the
 * tour cannot leave the app in a state the reader did not choose — the only
 * controls are its own.
 */

interface Stop {
  /** The `data-tour` value of the element to light up. */
  target: string;
  title: TranslationKey;
  body: TranslationKey;
}

const STOPS: Stop[] = [
  { target: 'metrics', title: 'walkthrough.feature.estimates', body: 'walkthrough.feature.estimatesBody' },
  { target: 'folder', title: 'walkthrough.feature.folders', body: 'walkthrough.feature.foldersBody' },
  { target: 'project-icon', title: 'walkthrough.feature.icons', body: 'walkthrough.feature.iconsBody' },
  { target: 'quick', title: 'tour.quick', body: 'tour.quickBody' },
  { target: 'subtasks', title: 'tour.subtasks', body: 'tour.subtasksBody' },
  { target: 'review', title: 'tour.review', body: 'tour.reviewBody' },
];

/** Where the element is, in viewport coordinates, plus a little air. */
interface Hole { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_W = 320;
const GAP = 14;

/**
 * Whether there is anything to point at.
 *
 * Deliberately not a question about the viewport: every stop scrolls its
 * element into view before it is shown, so "below the fold right now" is not a
 * reason to drop it. Asking that here is what silently cut the subtasks stop
 * out of a tour on a window too short to show it at the start.
 */
function exists(target: string): boolean {
  const el = targetElement(target);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 4 && r.height >= 4;
}

function measure(target: string): Hole | null {
  const el = targetElement(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;

  /* Some things are more than one element. A parent task and the subtasks
     under it are siblings, not a nest, so an element can ask for the ones
     that follow it to be taken in — and the highlight is drawn around all of
     them rather than around the first. */
  let [top, left, right, bottom] = [r.top, r.left, r.right, r.bottom];
  if (el.dataset.tourExtend === 'siblings') {
    let next = el.nextElementSibling;
    while (next instanceof HTMLElement && next.dataset.depth) {
      const c = next.getBoundingClientRect();
      top = Math.min(top, c.top);
      left = Math.min(left, c.left);
      right = Math.max(right, c.right);
      bottom = Math.max(bottom, c.bottom);
      next = next.nextElementSibling;
    }
  }

  return {
    top: top - PAD, left: left - PAD,
    width: right - left + PAD * 2, height: bottom - top + PAD * 2,
  };
}

function targetElement(target: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-tour="${target}"], [data-tour-fallback="${target}"]`,
  );
  return [...candidates].find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  }) ?? null;
}

export function Tour({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);

  /* The stops that have something to point at. Null until that has actually
     been worked out, which is not the same as "none" — telling the two apart
     is what stops the tour ending itself in the moment before it has looked. */
  const [stops, setStops] = useState<Stop[] | null>(null);
  useEffect(() => {
    if (!open) { setStops(null); return; }
    setIndex(0);
    // A beat's delay: the view this runs over has usually just been navigated
    // to, and measuring before it has laid out finds nothing and skips it all.
    const id = window.setTimeout(
      () => setStops(STOPS.filter((s) => exists(s.target))),
      150,
    );
    return () => window.clearTimeout(id);
  }, [open]);

  const stop = stops?.[index];

  useLayoutEffect(() => {
    if (!open || !stop) return;

    const el = targetElement(stop.target);
    /* Instant, not smooth. The highlight has a transition of its own, so a
       smooth scroll means measuring a page that is still moving: the rectangle
       glides to where the element *was* and only catches up at the end. One
       jump, then one glide, and the two never disagree on screen. */
    el?.scrollIntoView({ block: 'center', behavior: 'auto' });

    const update = () => setHole(measure(stop.target));
    update();
    // Layout can settle a frame late — a sticky header resolving, a font.
    const settle = window.setTimeout(update, 120);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, stop]);

  const count = stops?.length ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
      if (e.key === 'ArrowRight') setIndex((at) => Math.min(at + 1, count - 1));
      if (e.key === 'ArrowLeft') setIndex((at) => Math.max(at - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onDone, count]);

  // Looked, and there was nothing on this page to point at.
  useEffect(() => {
    if (open && stops !== null && stops.length === 0) onDone();
  }, [open, stops, onDone]);

  if (!open) return null;

  /* On compact layouts the real sidebar is intentionally absent. These are
     not replacement screenshots: they are a small live demo of the exact
     sidebar rows the tour would otherwise be unable to point at. */
  const demoTargets = createPortal(
    <aside className="tour-demo-targets" aria-hidden="true">
      <div data-tour-fallback="folder"><Icon name="project" /><span>Client work</span></div>
      <div data-tour-fallback="project-icon"><Icon name="dashboard" /><span>Website</span></div>
      <div data-tour-fallback="review"><Icon name="tasks" /><span>{t('nav.review')}</span></div>
    </aside>,
    document.body,
  );

  if (!stop || !hole) return demoTargets;

  const last = index === count - 1;

  /* Under the hole when there is room, above it when there is not, and clamped
     into the viewport either way — a card explaining something you cannot see
     is worse than one slightly off-centre. */
  const below = hole.top + hole.height + GAP;
  const fitsBelow = below + 150 < window.innerHeight;
  const top = fitsBelow ? below : Math.max(GAP, hole.top - 150 - GAP);
  const left = Math.min(
    Math.max(GAP, hole.left + hole.width / 2 - CARD_W / 2),
    window.innerWidth - CARD_W - GAP,
  );

  const overlay = createPortal(
    <div className="tour" role="dialog" aria-label={t('tour.title')}>
      {/* One element, one enormous shadow: everything outside the rectangle is
          dimmed, and the rectangle itself is left alone. Cheaper and steadier
          than four panels that have to agree with each other on every scroll. */}
      <div
        className="tour-hole"
        style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
      />

      <div className="tour-card" style={{ top, left, width: CARD_W }}>
        <h3>{t(stop.title)}</h3>
        <p>{t(stop.body)}</p>
        <div className="tour-foot">
          <span className="tour-dots" aria-hidden="true">
            {(stops ?? []).map((s, at) => (
              <i key={s.target} className={at === index ? 'on' : at < index ? 'done' : undefined} />
            ))}
          </span>
          <button className="tour-skip" onClick={onDone}>{t('tour.skip')}</button>
          <button
            className="btn primary"
            onClick={() => (last ? onDone() : setIndex((at) => at + 1))}
          >
            {last ? t('tour.done') : t('tour.next')}
            {!last && <Icon name="arrow-right" size="sm" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
  return <>{demoTargets}{overlay}</>;
}
