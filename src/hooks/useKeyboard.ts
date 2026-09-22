import { useEffect, useRef } from 'react';
import { useStore } from '@/store/store';
import { useConfirm } from '@/components/overlays/Confirm';
import { useT } from './useT';
import { navigate } from './useRoute';
import type { ViewId } from '@/domain/types';

/**
 * The whole of the keyboard, in one place.
 *
 * It was in three before — a handler in `App` for `⌘K`, `q` and undo, the
 * rows' own Enter, and the pickers' own arrows — and the moment a plain letter
 * started meaning something, the order those handlers ran in became the
 * feature. Two listeners both answering `q` is not a bug you find by reading
 * either one of them.
 *
 * ## The cursor is focus
 *
 * A row is already a `role="button"` with a tab stop and an Enter handler, so
 * the row the keyboard is on is simply the row that has focus. Nothing has to
 * be kept in sync with anything, a screen reader announces the row without
 * being told to, and Escape out of the task panel lands back on the row it was
 * opened from — the dialog shell already returns focus to wherever it came
 * from, which is the behaviour the issue asked for, unwritten.
 *
 * The cursor is not carried between pages. Restoring one on arrival would mean
 * taking focus on every navigation, which fights anyone tabbing through the
 * page for a keystroke they did not ask for; arriving on a page, the first
 * Down goes to the top of it.
 *
 * ## Letters are commands on a row, and text everywhere else
 *
 * Todoist's task shortcuts need a task — `e`, `t`, `v`, `x`, `1`–`4` act on
 * the one the cursor is on. With no cursor there is no task to act on, so the
 * same letters are what they look like: typing, which opens the search with
 * the letter already in it. One sentence covers every key, which is the most
 * that can be said for any mapping that has both.
 *
 * Letters Todoist gives a meaning this app has no equivalent for are left
 * alone rather than invented: `l` labels a task and `c` comments on one, and
 * neither exists here. Bound to nothing they are still useful — they start a
 * search, like every other letter.
 *
 * ## Going somewhere is `g` and a letter
 *
 * Todoist's arrangement, kept for the reason it exists: a bare letter per
 * destination would take `w`, `u`, `s` and `i` away from typing, and typing is
 * how you reach a project. A prefix costs one key and leaves the alphabet
 * alone — which is also why `/` can stay as a second way into the search
 * without ever being mistaken for a word.
 */

/**
 * How long a ticked row is held before it goes, matching `TaskRow`'s own pause.
 * The cursor takes the place over once the row in it has actually left.
 */
const TICK_SETTLES_MS = 480;

/** The keys that act on the row under the cursor, and are never typed into search. */
const ROW_KEYS = new Set(['e', 't', 'v', 'x', '1', '2', '3', '4', '.']);

/**
 * Where `g` then a letter goes.
 *
 * Todoist's own arrangement, and the reason for it is the one that matters
 * here: a bare letter for each destination would take `w`, `u`, `s` and `i`
 * away from typing, and typing is how you reach a project. A prefix costs one
 * key — `g` — and leaves the alphabet alone.
 *
 * The letters are Todoist's where Todoist has the view, and the first letter
 * of the view's own name where it does not.
 */
const GO_TO: Record<string, ViewId> = {
  i: 'inbox',
  t: 'today',
  w: 'week',
  u: 'upcoming',
  s: 'someday',
  r: 'review',
  l: 'labels',
  a: 'insights',
  ',': 'settings',
};

/** How long `g` waits for the letter that follows it. */
const PREFIX_MS = 1500;

/** The tasks on the page in front, in the order they are drawn. */
function rows(): HTMLElement[] {
  const screen = document.querySelector('.screen.active') ?? document;
  return [...screen.querySelectorAll<HTMLElement>('[data-task-id]')]
    // A row inside a collapsed group is in the document and not on the page.
    .filter((row) => row.offsetParent !== null);
}

const rowOf = (node: Element | null): HTMLElement | null =>
  (node instanceof HTMLElement ? node.closest<HTMLElement>('[data-task-id]') : null);

/* Moved to, not scrolled to: `nearest` keeps the list still when the row is
   already in sight, and brings it just inside the edge when it is not. */
function land(row: HTMLElement | undefined) {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

/**
 * What the keyboard asks a row to do that only the row can do.
 *
 * `t` and `v` open menus that live inside the row's own actions, as component
 * state. A context would tell every row on the page that one of them has been
 * asked for something; the row is a DOM node and the message is for it alone.
 */
export type RowMenu = 'schedule' | 'move' | 'more';
export const ROW_MENU_EVENT = 'enhanced:rowmenu';

interface KeyboardBridge {
  openTask: (id: string) => void;
  /** Opens the search with what was typed already in it. */
  openSearch: (seed: string) => void;
  openComposer: () => void;
  openShortcuts: () => void;
}

export function useKeyboard(bridge: KeyboardBridge) {
  const confirm = useConfirm();
  const { t } = useT();

  /* The listener is registered once and reads the current callbacks through a
     ref: every one of them is a fresh arrow on every render of the page, and
     tearing the listener down and putting it back on each of those is how a
     keystroke gets lost between the two. */
  const live = useRef({ bridge, confirm, t });
  live.current = { bridge, confirm, t };

  useEffect(() => {
    /** Where the cursor was, so a row that finishes hands the place on. */
    let lastIndex = 0;
    /** `g` has been pressed and the app is waiting to hear where to go. */
    let goingTo = false;
    let goingTimer: ReturnType<typeof setTimeout> | undefined;
    const stopGoing = () => {
      goingTo = false;
      if (goingTimer) clearTimeout(goingTimer);
    };

    const ask = (row: HTMLElement, menu: RowMenu) => {
      row.dispatchEvent(new CustomEvent(ROW_MENU_EVENT, { detail: menu }));
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;

      const store = useStore.getState();
      const { bridge: to, confirm: ask_, t: say } = live.current;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        to.openSearch('');
        return;
      }

      /* Undo. Not while typing: inside a field the browser's own undo is the
         right one, and taking it away to reverse a task change instead would
         be startling. Shift+Cmd+Z is left alone — there is no redo here, and
         silently treating it as another undo would be worse than nothing. */
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        void store.undo();
        return;
      }

      if (typing) return;

      /* A dialog or a row menu in front owns the keyboard. Each closes on
         Escape by itself, and nothing behind one should answer a letter typed
         into it. */
      if (document.querySelector('.overlay.open, .rowmenu')) return;

      const current = rowOf(document.activeElement);

      if (e.key === 'Escape') {
        /* Escape gives back the outermost thing that can be given back: the
           selection first, then the cursor. A dialog and an open menu both
           stop the event before it reaches here, so by the time it does, one
           of these two is what Escape means. */
        if (store.selection.length > 0) {
          e.preventDefault();
          store.clearSelection();
          return;
        }
        if (current) { e.preventDefault(); current.blur(); }
        return;
      }

      const step = e.key === 'ArrowDown' || (e.key === 'j' && !e.metaKey && !e.ctrlKey)
        ? 1
        : e.key === 'ArrowUp' || (e.key === 'k' && !e.metaKey && !e.ctrlKey)
          ? -1
          : 0;
      if (step !== 0) {
        const list = rows();
        if (list.length === 0) return;
        e.preventDefault();
        const at = current ? list.indexOf(current) : -1;
        // With no cursor yet, Down starts at the top and Up at the bottom.
        const next = at < 0
          ? (step > 0 ? 0 : list.length - 1)
          : Math.min(list.length - 1, Math.max(0, at + step));
        lastIndex = next;
        land(list[next]);
        return;
      }

      /* `g`, then where to. A prefix rather than a letter each, so that the
         letters themselves stay available for typing — which is the other
         half of how this app is navigated. */
      if (goingTo) {
        e.preventDefault();
        const to = GO_TO[e.key.toLowerCase()];
        stopGoing();
        if (!to) return;
        /* Today is a page of its own only when the week is split in two. Left
           unified it is the top of My week, and there is no Today in the
           sidebar to have meant — so `g t` goes where Today is. */
        const merged = to === 'today' && store.prefs.weekLayout === 'unified';
        navigate(merged ? 'week' : to);
        return;
      }
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        goingTo = true;
        goingTimer = setTimeout(() => { goingTo = false; }, PREFIX_MS);
        return;
      }

      // Quick add, whatever the cursor is on.
      if (e.key === 'q' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        to.openComposer();
        return;
      }
      if (e.key === '/' ) { e.preventDefault(); to.openSearch(''); return; }
      if (e.key === '?') { e.preventDefault(); to.openShortcuts(); return; }

      if (current) {
        const id = current.dataset.taskId ?? '';
        const item = store.snapshot.items[id];
        if (!item) return;
        lastIndex = Math.max(0, rows().indexOf(current));

        /* Todoist opens a task with Enter and edits it with Cmd+E, which here
           are the same panel and so the same key twice. Enter is the row's
           own; this is the other one. */
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          to.openTask(id);
          return;
        }

        if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
          e.preventDefault();
          /* A selection is a deliberate answer to "which ones", and it wins
             over the cursor, which is only ever where you last were. Deleting
             the row under the cursor while three tasks sat picked in front of
             you deleted one of them and left the other two.

             Only when the cursor is inside the selection, though: arrowing
             away from a selection and pressing this means the row you have
             arrowed to. */
          const picked = store.selection;
          const many = picked.length > 1 && picked.includes(id);

          /* The confirmation stays. Deleting is the one thing that should
             never be one keystroke away from done, and a keystroke is a
             cheaper accident than a click. */
          void ask_({
            title: say(many ? 'task.deleteTitleMany' : 'task.deleteTitle'),
            body: many
              ? say('bulk.deleteConfirm', { count: picked.length })
              : say('task.deleteConfirm', { name: item.content }),
            confirmLabel: say('task.delete'),
            destructive: true,
          }).then((ok) => {
            if (!ok) return;
            const at = lastIndex;
            const gone = many
              ? (store.clearSelection(), store.removeTasks(picked))
              : store.removeTask(id);
            void gone.then(() => {
              // The place stays even though the row in it has gone.
              window.setTimeout(() => land(rows()[Math.min(at, rows().length - 1)]), 0);
            });
          });
          return;
        }

        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'e') {
          e.preventDefault();
          /* The row's own tick, not the store underneath it: ticking a task
             off holds the row for a moment before it goes, and a keystroke
             that skipped that would be a second way of completing a task that
             looks nothing like the first. */
          const at = lastIndex;
          const picked = store.selection;
          const many = picked.length > 1 && picked.includes(id);
          if (many) {
            for (const pickedId of picked) {
              document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(pickedId)}"] .check`)?.click();
            }
            store.clearSelection();
          } else {
            current.querySelector<HTMLElement>('.check')?.click();
          }
          window.setTimeout(() => land(rows()[Math.min(at, rows().length - 1)]), TICK_SETTLES_MS);
          return;
        }
        if (e.key === 't') { e.preventDefault(); ask(current, 'schedule'); return; }
        if (e.key === 'T') {
          // Shift+T, as in Todoist: the date comes off.
          e.preventDefault();
          void store.updateTask(id, { due: null });
          return;
        }
        if (e.key === 'v') { e.preventDefault(); ask(current, 'move'); return; }
        if (e.key === '.') { e.preventDefault(); ask(current, 'more'); return; }
        if (e.key === 'x') { e.preventDefault(); store.toggleSelection(id); return; }
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault();
          // Todoist counts priority the other way up: its 4 is p1.
          void store.updateTask(id, { priority: 5 - Number(e.key) });
          return;
        }
      }

      /* Anything else that is a character is what it looks like. Things does
         this: you start typing and the search takes it, with no shortcut
         first — and the search here already reaches projects, sections, tags
         and views, so it is also how you get to a project without a mouse. */
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1 || e.key === ' ') return;
      if (current && ROW_KEYS.has(e.key.toLowerCase())) return;
      e.preventDefault();
      to.openSearch(e.key);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stopGoing();
    };
  }, []);
}
