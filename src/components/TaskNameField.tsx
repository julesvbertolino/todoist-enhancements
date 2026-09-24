import {
  createElement, useEffect, useLayoutEffect, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject,
  type SyntheticEvent,
} from 'react';
import { Icon } from './Icon';
import { markerStyle } from '@/domain/colors';
import {
  carryRanges, parseShorthand, type HighlightKind, type TextRange,
} from '@/domain/shorthand';
import { useStore } from '@/store/store';
import { useT } from '@/hooks/useT';
import type { Snapshot } from '@/domain/types';
import { bySectionOrder } from '@/domain/orderKey';

/** A name with its spaces, case and accents set aside, as the parser reads it. */
const squash = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

/** The `@tag` or `#project` the caret is currently inside, if any. */
function tokenAtCaret(
  value: string, caret: number,
): { sigil: '@' | '#'; query: string; start: number } | null {
  const before = value.slice(0, caret);
  const match = before.match(/(^|\s)([@#])([\p{L}\p{N}_/-]*)$/u);
  if (!match) return null;
  return {
    sigil: match[2] as '@' | '#',
    query: match[3].toLowerCase(),
    start: caret - match[3].length - 1,
  };
}

interface TaskNameFieldProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ariaLabel: string;
  snapshot: Snapshot;
  naturalDates: boolean;
  /**
   * A field that wraps rather than scrolling, for the task panel's title.
   *
   * The mirror follows: both layers wrap at the same width with the same
   * metrics, so a mark stays on its word however many lines the title takes.
   */
  multiline?: boolean;
  /** The class the field itself carries, so a caller can keep its own look. */
  fieldClassName?: string;
  /** Called when the field loses the caret, for a title that saves on blur. */
  onBlur?: () => void;
  /** Escape, when no list is open: for a field whose edit can be abandoned. */
  onCancel?: () => void;
  /** The field's own element, for a caller that has to focus or release it. */
  fieldRef?: MutableRefObject<(HTMLTextAreaElement | HTMLInputElement) | null>;
  /** The readings turned down so far, as positions in `value`. */
  refusals: TextRange[];
  /**
   * The refusals after a gesture or an edit. `refused` is set when this call
   * is a new refusal, so the caller can put back the field that reading had
   * filled in; `restored` when one is taken back.
   */
  onRefusals: (
    next: TextRange[],
    change?:
      | { kind: 'refused'; range: TextRange; reading: HighlightKind }
      | { kind: 'restored'; range: TextRange },
  ) => void;
}

/**
 * The composer's name field.
 *
 * What the parser will take out of the name is marked inside the name while it
 * is typed, the way Todoist does it. An `<input>` cannot hold markup, so a
 * mirror of the same text sits behind it: transparent letters, coloured
 * rounded backgrounds. The real text stays in the real input, so selection,
 * the caret and every input method keep working.
 *
 * Typing `@` or `#` opens the matching list, because the alternative is
 * remembering the names of your own projects.
 */
export function TaskNameField({
  value, onChange, onSubmit, placeholder, ariaLabel, snapshot, naturalDates,
  refusals, onRefusals, multiline = false, fieldClassName, onBlur, onCancel, fieldRef,
}: TaskNameFieldProps) {
  const { t } = useT();
  const createLabel = useStore((s) => s.createLabel);
  const inputRef = useRef<(HTMLInputElement & HTMLTextAreaElement) | null>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);

  const { ranges } = parseShorthand(value, snapshot, naturalDates, refusals);
  const token = tokenAtCaret(value, caret);

  /**
   * The refusals that are still refusing something.
   *
   * A refusal only earns its dotted line if taking it back would put a mark
   * exactly where it sits: after enough editing around it, the parser may have
   * nothing to say about those words any more, and an underline offering to
   * restore a reading that no longer exists is a lie. Re-reading the name once
   * per refusal is cheap — there are never more than a few, and the name is one
   * line long.
   */
  const live = refusals.filter((refusal) => {
    const without = refusals.filter((other) => other !== refusal);
    return parseShorthand(value, snapshot, naturalDates, without).ranges.some(
      (mark) => mark.start === refusal.start && mark.end === refusal.end,
    );
  });

  /** Turns a reading down, and tells the caller which field it had filled. */
  const refuse = (mark: { start: number; end: number; kind: HighlightKind }) => {
    onRefusals(
      [...refusals, { start: mark.start, end: mark.end }],
      { kind: 'refused', range: { start: mark.start, end: mark.end }, reading: mark.kind },
    );
  };

  /** Takes a refusal back, so the words are read again. */
  const restore = (range: TextRange) => {
    onRefusals(
      refusals.filter((other) => other !== range),
      { kind: 'restored', range },
    );
  };

  const options = (() => {
    if (!token) return [];
    if (token.sigil === '#') {
      const projects = Object.values(snapshot.projects)
        .filter((p) => !p.is_archived && !p.is_deleted && !p.is_folder);
      const sectionsOf = (projectId: string) => Object.values(snapshot.sections)
        .filter((s) => s.project_id === projectId && !s.is_archived && !s.is_deleted)
        .sort(bySectionOrder);

      const slash = token.query.indexOf('/');
      const head = slash < 0 ? token.query : token.query.slice(0, slash);
      const tail = slash < 0 ? null : token.query.slice(slash + 1);

      /* Past the slash the question has changed: the project is settled and
         the list is its sections, narrowing on what follows. */
      if (tail !== null) {
        const owner = projects.find((p) => squash(p.name) === squash(head));
        if (!owner) return [];
        return sectionsOf(owner.id)
          .filter((s) => squash(s.name).includes(squash(tail)))
          .slice(0, 6)
          .map((s) => ({
            id: s.id,
            name: `${owner.name}/${s.name}`,
            label: s.name,
            hint: owner.name,
            color: owner.color,
            sigil: '#' as const,
            isNew: false,
          }));
      }

      const sectionOption = (p: { id: string; name: string; color: string }) =>
        (s: { id: string; name: string }) => ({
          id: s.id,
          name: `${p.name}/${s.name}`,
          label: s.name,
          hint: p.name,
          color: p.color,
          sigil: '#' as const,
          isNew: false,
        });

      const matching = projects.filter((p) => squash(p.name).includes(squash(head)));
      const matched = new Set(matching.map((p) => p.id));

      /* A project brings its sections with it, whether or not their names have
         anything to do with what was typed: the point of naming the project is
         to be shown where inside it the task could go. Each project is followed
         by its own, so the list reads as the tree it is. */
      const withSections = matching.flatMap((p) => [
        {
          id: p.id,
          name: p.name,
          label: p.name,
          hint: undefined as string | undefined,
          color: p.color,
          sigil: '#' as const,
          isNew: false,
        },
        /* Nothing typed yet is a list of projects, not of every section in
           the account: the sections arrive once a project is being named. */
        ...(head === '' ? [] : sectionsOf(p.id).map(sectionOption(p))),
      ]);

      /* And a section whose own name matches, in a project whose name does
         not: "relire" should find it without naming the project first. */
      const elsewhere = head === '' ? [] : projects
        .filter((p) => !matched.has(p.id))
        .flatMap((p) => sectionsOf(p.id)
          .filter((s) => squash(s.name).includes(squash(head)))
          .map(sectionOption(p)));

      return [...withSections, ...elsewhere].slice(0, 8);
    }
    const known = Object.values(snapshot.labels)
      .filter((l) => !l.is_deleted && !l.name.startsWith('est-'))
      .filter((l) => l.name.toLowerCase().includes(token.query))
      .slice(0, 6)
      .map((l) => ({
        id: l.id,
        name: l.name,
        label: l.name,
        hint: undefined as string | undefined,
        color: l.color,
        sigil: '@' as const,
        isNew: false,
      }));

    /* A tag you have not made yet is the common case when you are typing one:
       the list offers to make it rather than silently matching nothing. */
    const exact = Object.values(snapshot.labels).some(
      (l) => !l.is_deleted && l.name.toLowerCase() === token.query,
    );
    if (token.query && !exact) {
      known.push({
        id: '__new__',
        name: token.query,
        label: token.query,
        hint: undefined,
        color: 'charcoal',
        sigil: '@' as const,
        isNew: true,
      });
    }
    return known;
  })();

  useEffect(() => { setPick(0); }, [value, caret]);

  // The mirror must follow the input's own scroll, or the marks drift off the
  // text as soon as the name is longer than the field.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const sync = () => { mirror.scrollLeft = input.scrollLeft; };
    sync();
    input.addEventListener('scroll', sync);
    return () => input.removeEventListener('scroll', sync);
  }, [value]);

  /* A wrapping field is exactly as tall as its text, so the mirror behind it —
     which is the height of the box — cannot end up a line short. */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!multiline || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline, value]);

  const choose = (name: string, isNew = false) => {
    if (!token) return;
    // Made before it is inserted, so the tag it names exists by the time the
    // task carrying it is saved.
    if (isNew) void createLabel(name);
    const needsQuotes = /\s/.test(name);
    const inserted = `${token.sigil}${needsQuotes ? name.replace(/\s+/g, '') : name} `;
    const next = value.slice(0, token.start) + inserted + value.slice(caret);
    onChange(next);
    const position = token.start + inserted.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  /**
   * Everything the mirror draws, plus the refusals it does not.
   *
   * A refused run is drawn as what it now is: ordinary text, with nothing
   * under it and nothing behind it. It still has to be in this list, because
   * clicking it is what brings the reading back.
   */
  const spans: Array<
    TextRange & { kind?: HighlightKind; tone?: string; refused?: TextRange }
  > = [
    ...ranges.map((range) => ({
      start: range.start, end: range.end, kind: range.kind, tone: range.tone,
    })),
    ...live
      .filter((r) => !ranges.some((mark) => r.start < mark.end && r.end > mark.start))
      .map((r) => ({ start: r.start, end: r.end, refused: r })),
  ].sort((a, b) => a.start - b.start);

  const pieces: Array<{
    text: string; kind?: HighlightKind; tone?: string; refused?: boolean;
  }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) pieces.push({ text: value.slice(cursor, span.start) });
    pieces.push({
      text: value.slice(span.start, span.end),
      kind: span.kind,
      tone: span.tone,
      refused: span.refused !== undefined,
    });
    cursor = span.end;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor) });

  const track = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);

  /**
   * A click inside a marked word turns the reading off, and a click inside a
   * refused one turns it back on.
   *
   * Strictly inside: a click landing exactly at either edge is somebody
   * putting the caret beside the word, not somebody aiming at it.
   */
  const clicked = (at: number) => {
    const span = spans.find((s) => at > s.start && at < s.end);
    if (!span) return;
    if (span.refused) restore(span.refused);
    else if (span.kind) refuse({ start: span.start, end: span.end, kind: span.kind });
  };

  return (
    <div className={`namefield${multiline ? ' multiline' : ''}`}>
      <div className="namemirror" ref={mirrorRef} aria-hidden="true">
        {pieces.map((piece, index) =>
          piece.kind && !piece.refused
            ? (
              <mark
                className={`nmark ${piece.kind}`}
                key={index}
                /* The thing's own colour, when it has one: a project's, a
                   tag's, the priority's. A guess made from prose has none and
                   falls through to the accent the stylesheet gives it. */
                style={piece.tone ? ({ '--mark': piece.tone } as React.CSSProperties) : undefined}
              >
                {piece.text}
              </mark>
            )
            : <span key={index}>{piece.text}</span>,
        )}
        {/* A trailing space has no width of its own and would let the last mark
            sit flush against the field's edge. */}
        <span>{'\u200b'}</span>
      </div>

      {createElement(multiline ? 'textarea' : 'input', {
        ref: (node: HTMLInputElement & HTMLTextAreaElement) => {
          inputRef.current = node;
          if (fieldRef) fieldRef.current = node;
        },
        className: fieldClassName ?? 'composer-name',
        placeholder,
        'aria-label': ariaLabel,
        autoFocus: !multiline,
        rows: multiline ? 1 : undefined,
        onBlur,
        value,
        onChange: (e: ChangeEvent<HTMLInputElement>) => {
          /* The refusals are positions in the text being edited, so they move
             with it before anything is read from it again. */
          const next = e.target.value;
          const carried = carryRanges(refusals, value, next);
          if (carried.length !== refusals.length
            || carried.some((r, at) => r.start !== refusals[at].start)) {
            onRefusals(carried);
          }
          onChange(next);
          track(e.target);
        },
        onSelect: (e: SyntheticEvent<HTMLInputElement>) => track(e.currentTarget),
        onClick: (e: MouseEvent<HTMLInputElement>) => {
          track(e.currentTarget);
          clicked(e.currentTarget.selectionStart ?? 0);
        },
        onKeyUp: (e: KeyboardEvent<HTMLInputElement>) => track(e.currentTarget),
        onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
          /* Cmd+Enter is the sheet's, not the field's: it saves the whole
             thing. Answering it here as well as there submitted the task
             twice — two handlers for one keystroke, and the task arrived in
             Todoist in duplicate. */
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return;

          if (options.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setPick((p) => (p + 1) % options.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setPick((p) => (p - 1 + options.length) % options.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(options[pick].name, options[pick].isNew);
              return;
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setCaret(-1);
              return;
            }
          }
          /* Backspace against a mark takes the reading off rather than the
             letter: the word was typed on purpose, it is the app's reading of
             it that was not wanted. A second Backspace deletes, as usual,
             because by then there is no reading left to refuse. */
          if (e.key === 'Backspace') {
            const input = e.currentTarget;
            const at = input.selectionStart ?? 0;
            if (at === input.selectionEnd) {
              const mark = ranges.find((range) => range.end === at);
              if (mark) {
                e.preventDefault();
                refuse(mark);
                return;
              }
            }
          }

          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }

          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        },
      })}

      {options.length > 0 && (
        <div className="popover namepicker" role="listbox">
          {options.map((option, index) => (
            <button
              key={option.id}
              role="option"
              aria-selected={index === pick}
              onMouseDown={(e) => { e.preventDefault(); choose(option.name, option.isNew); }}
              onMouseEnter={() => setPick(index)}
            >
              {option.hint
                ? <Icon name="section" size="sm" className="taglabel" style={markerStyle(option.color, false)} />
                : option.sigil === '#'
                  ? <span className="hash" style={markerStyle(option.color)}>#</span>
                  : <Icon name={option.isNew ? 'plus' : 'tag'} size="sm" className="taglabel" style={markerStyle(option.color, false)} />}
              <span>{option.label}</span>
              {option.hint && <small className="namepicker-new">{option.hint}</small>}
              {option.isNew && <small className="namepicker-new">{t('labels.createNew')}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
