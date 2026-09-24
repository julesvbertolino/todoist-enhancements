import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { copyText, isTemporaryId, todoistTaskUrl } from '@/api/links';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Overlay } from './Overlay';
import { Icon } from '../Icon';
import { useT } from '@/hooks/useT';
import { useMenuKeys } from '@/hooks/useMenuKeys';
import { useData } from '@/hooks/useData';
import { navigate } from '@/hooks/useRoute';
import { useStore } from '@/store/store';
import { useConfirm } from './Confirm';
import {
  effectiveEstimate, formatDuration, withEstimate,
} from '@/domain/estimates';
import { deadlineDate, dueDate, formatRelativeDay, toApiDate } from '@/domain/dates';
import { renderMarkdown } from '@/domain/markdown';
import { parseShorthand, type TextRange } from '@/domain/shorthand';
import { dueForDate, readRecurrence } from '@/domain/recurrence';
import { EstimateField } from '../EstimateField';
import { TaskNameField } from '../TaskNameField';
import { Select } from '../Select';
import { PlacementField } from '../PlacementField';
import { DateField } from '../DateField';
import { markerStyle } from '@/domain/colors';
import { displayTaskContent, isUncompletable, toDisplayPriority, toTodoistPriority, type DisplayPriority, type Item } from '@/domain/types';
import { matchesSearch } from '@/domain/search';
import { byLabelOrder } from '@/domain/orderKey';

/**
 * The repeat rule, as a rule rather than as a reading of one.
 *
 * What is typed here is handed to Todoist whole: it resolves the rule, and it
 * is the only thing that can, since where the next occurrence falls depends on
 * when this one is completed. The field's whole job is to refuse a phrase the
 * app cannot vouch for rather than send it and find out — a rule read wrongly
 * does not fail, it moves every future occurrence and says nothing.
 *
 * Emptying it stops the repeat without losing the date: the occurrence the
 * task is sitting on becomes its due date, once.
 */
function RecurrenceField({ item }: { item: Item }) {
  const { t } = useT();
  const updateTask = useStore((s) => s.updateTask);
  const setRecurrence = useStore((s) => s.setRecurrence);
  const rule = item.due?.is_recurring ? item.due.string : '';
  const [draft, setDraft] = useState(rule);
  const [refused, setRefused] = useState(false);

  // A rule Todoist rewrote on save — "every mon" comes back "every monday" —
  // is the truth, so the field follows the task rather than the typing.
  useEffect(() => { setDraft(rule); setRefused(false); }, [rule, item.id]);

  function commit() {
    const typed = draft.trim();
    if (typed === rule.trim()) { setRefused(false); return; }

    if (!typed) {
      setRefused(false);
      if (!item.due?.is_recurring) return;
      // The occurrence it is on becomes the date it keeps.
      const date = item.due.date;
      void updateTask(item.id, {
        due: { date, timezone: item.due.timezone, string: date, lang: item.due.lang, is_recurring: false },
      });
      return;
    }

    const read = readRecurrence(typed);
    if (!read) { setRefused(true); return; }
    setRefused(false);
    void setRecurrence(item.id, read);
  }

  return (
    <div className="repeatfield">
      <span className="repeatinput">
        <Icon name="repeat" size="sm" />
        <input
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setRefused(false); }}
          onBlur={commit}
          onKeyDown={(event) => {
            /* Enter commits outright rather than blurring and letting the blur
               commit: a refusal has to be able to keep the caret in the field
               that is being refused, and blurring gives it away first. */
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            if (event.key === 'Escape') { setDraft(rule); setRefused(false); }
          }}
          placeholder={t('detail.recurringPlaceholder')}
          aria-label={t('detail.recurring')}
          aria-invalid={refused}
        />
      </span>
      {refused && <small className="repeatrefused">{t('detail.recurringRefused')}</small>}
      {!refused && item.due?.is_recurring && item.due.string.includes('!') && (
        <small className="repeathint">{t('detail.recurringFromCompletion')}</small>
      )}
    </div>
  );
}

interface TaskDetailProps {
  taskId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}

/** The id a subtask row registers under, in both of its roles. */
export const subtaskRowId = (id: string): string => `subtask:${id}`;

/**
 * A subtask row that can be picked up and dropped onto another.
 *
 * It registers in the app's one drag context rather than opening a second, the
 * way the sidebar's project rows do, and it is both the handle and the landing
 * place — dropping one on another puts it in that one's position.
 */
function SubtaskRow({ id, children }: { id: string; children: React.ReactNode }) {
  const rowId = subtaskRowId(id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: rowId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: rowId });
  const { t } = useT();

  return (
    <div
      ref={setDropRef}
      className={`subtaskrow${isDragging ? ' lifting' : ''}${isOver && !isDragging ? ' landing' : ''}`}
    >
      {/* Dragged by its handle, so the row's own controls keep working. */}
      <span className="drag subdrag" title={t('detail.reorderSubtask')} ref={setNodeRef} {...attributes} {...listeners}>
        <Icon name="drag" size="sm" />
      </span>
      {children}
    </div>
  );
}

function EditableSubtask({ child, onOpen }: { child: Item; onOpen: (id: string) => void }) {
  const { t } = useT();
  const updateTask = useStore((s) => s.updateTask);
  const toggleTask = useStore((s) => s.toggleTask);
  const removeTask = useStore((s) => s.removeTask);
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(child.content);
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(child.content);
  }, [child.content, editing]);

  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };
  const save = () => {
    const content = draft.trim();
    if (!content) { inputRef.current?.focus(); return; }
    if (content !== child.content) void updateTask(child.id, { content });
    stopEditing();
  };
  const deleteSubtask = async () => {
    const ok = await confirm({
      title: t('task.deleteTitle'),
      body: t('task.deleteConfirm', { name: child.content }),
      confirmLabel: t('task.delete'),
      destructive: true,
    });
    if (ok) {
      await removeTask(child.id);
      document.querySelector<HTMLElement>('.detail-section .addline')?.focus();
    } else editRef.current?.focus();
  };

  return (
    <SubtaskRow id={child.id}>
      {isUncompletable(child) ? (
        <span className={`check p${toDisplayPriority(child.priority)} nocheck`} aria-hidden="true" />
      ) : (
        <span
          className={`check p${toDisplayPriority(child.priority)}`}
          role="checkbox"
          aria-checked={child.checked}
          aria-label={t('task.complete')}
          tabIndex={0}
          onClick={() => void toggleTask(child.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void toggleTask(child.id);
            }
          }}
        ><Icon name="check" /></span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="textfield subtaskedit"
          autoFocus
          value={draft}
          aria-label={t('detail.editSubtask')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            if (event.key === 'Escape') { event.preventDefault(); stopEditing(); }
          }}
        />
      ) : (
        <button className="subtasktitle" onClick={() => onOpen(child.id)}>
          <span style={child.checked ? { textDecoration: 'line-through', color: 'var(--faint)' } : undefined}>
            {displayTaskContent(child)}
          </span>
        </button>
      )}
      <span className="subtaskactions">
        {editing ? (
          <button className="subtaskaction" onClick={save}>{t('common.save')}</button>
        ) : (
          <button ref={editRef} className="subtaskaction" aria-label={t('detail.editSubtask')} onClick={() => setEditing(true)}>
            <Icon name="edit" size="sm" />
          </button>
        )}
        <button className="subtaskaction danger" aria-label={t('detail.deleteSubtask')} onClick={() => void deleteSubtask()}>
          {t('task.delete')}
        </button>
      </span>
    </SubtaskRow>
  );
}

/**
 * The full task.
 *
 * Laid out as in the design: the checkbox and title share a line, the
 * description sits on the title's own left edge, and every property lives in
 * the right-hand column. Destructive actions are behind the overflow menu,
 * never next to Close.
 */
/**
 * Which property each letter opens, inside an opened task.
 *
 * Todoist's letters where Todoist has one for the same thing, and the first
 * letter of the property's own name where it does not. `t` is the date, as it
 * is on a row; `d` is the deadline, which is the other date and needs telling
 * apart from it.
 */
const PANEL_KEYS: Record<string, string> = {
  p: 'project',
  t: 'start',
  d: 'deadline',
  e: 'estimate',
  y: 'priority',
  l: 'tags',
};

/** The same table read the other way, for the letter a property shows. */
const KEY_FOR_PROP: Record<string, string> = Object.fromEntries(
  Object.entries(PANEL_KEYS).map(([key, prop]) => [prop, key.toUpperCase()]),
);

/**
 * A property's name, with the key that opens it.
 *
 * Small and faint, and beside the name rather than in place of anything: a
 * shortcut nobody can see is a shortcut nobody has, and the way these are
 * learnt is by noticing them while doing the thing the slow way. On a phone
 * there is no keyboard to tell about, so there is nothing to say.
 */
function PropLabel({ name, prop }: { name: string; prop: string }) {
  const key = KEY_FOR_PROP[prop];
  return (
    <span className="proplabel">
      {name}
      {key && <kbd className="propkey" aria-hidden="true">{key}</kbd>}
    </span>
  );
}

export function TaskDetail({ taskId, onClose, onOpen }: TaskDetailProps) {
  const { t, locale } = useT();
  const { snapshot, childrenOf } = useData();
  const updateTask = useStore((s) => s.updateTask);
  const toggleTask = useStore((s) => s.toggleTask);
  const removeTask = useStore((s) => s.removeTask);
  const createTask = useStore((s) => s.createTask);
  const moveTask = useStore((s) => s.moveTask);
  const setRecurrence = useStore((s) => s.setRecurrence);
  const skipOccurrence = useStore((s) => s.skipOccurrence);
  const naturalDates = useStore((s) => s.prefs.naturalDates);
  const toast = useStore((s) => s.toast);
  const demo = useStore((s) => s.demo);
  const confirm = useConfirm();

  const item = taskId ? snapshot.items[taskId] : null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  /** Readings of the title turned down while editing it. */
  const [refusals, setRefusals] = useState<TextRange[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useMenuKeys(menuOpen, () => setMenuOpen(false));
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  /**
   * Keeps the description box exactly as tall as its text, so leaving the
   * field does not change the height of the panel.
   *
   * The editor was a fixed 96px box that scrolled, and the rendered view below
   * it is as tall as the text — so clicking away from a long description made
   * the panel jump open under the pointer, which is what it looked like when
   * clicking "add subtask" right after pasting one in. Edited and rendered are
   * the same height now, and nothing moves on the way between them.
   */
  /** Asked for, then done. The one action in here that cannot be taken back. */
  const askThenDelete = useCallback(() => {
    if (!item) return;
    setMenuOpen(false);
    const { id, content } = item;
    void confirm({
      title: t('task.deleteTitle'),
      body: t('task.deleteConfirm', { name: content }),
      confirmLabel: t('task.delete'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void removeTask(id);
      onClose();
    });
  }, [confirm, item, onClose, removeTask, t]);

  /**
   * The panel's own keys.
   *
   * A task opened is a page of its own, and until now the only thing the
   * keyboard could do to it was close it. Each property answers to the letter
   * it starts with — Todoist's letter where Todoist has one — and the key
   * opens the field rather than editing it, because the fields are pickers
   * that already know how to be driven from a keyboard once they are open.
   *
   * Only while the caret is not in a field. Every one of these letters is also
   * a letter, and the title and the description are both places somebody is
   * typing words that contain them.
   */
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable) return;
      // A picker already open is driving the keyboard itself.
      if (document.querySelector('.datepanel, .listbox, .popover.rowmenu')) return;

      if ((event.metaKey || event.ctrlKey)
        && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault();
        askThenDelete();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '.') {
        event.preventDefault();
        setMenuOpen((open) => !open);
        return;
      }

      const prop = PANEL_KEYS[event.key.toLowerCase()];
      if (!prop) return;
      const row = panelRef.current?.querySelector<HTMLElement>(`[data-prop="${prop}"]`);
      const control = row?.querySelector<HTMLElement>('button, input, textarea');
      if (!control) return;
      event.preventDefault();
      control.scrollIntoView({ block: 'nearest' });
      /* A button here is a picker's face, and opening it is the whole point of
         the key; a field is somewhere to type, and is simply given the caret. */
      if (control.tagName === 'BUTTON') control.click();
      else control.focus();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [askThenDelete, item]);

  const fitDescription = useCallback(() => {
    const el = descriptionRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const border =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + border}px`;
  }, []);

  // Re-seed the editable fields whenever a different task is opened.
  useEffect(() => {
    if (!item) return;
    setTitle(item.content);
    setDescription(item.description);
    setEditingDescription(false);
    setAddingSubtask(false);
    setSubtaskDraft('');
    setRefusals([]);
    setMenuOpen(false);
    setTagPickerOpen(false);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingDescription) descriptionRef.current?.focus();
  }, [editingDescription]);

  // Measured after layout, and again once webfonts settle, because the text
  // height is not final on the first paint.
  useLayoutEffect(fitDescription, [fitDescription, description, editingDescription, taskId]);
  // Measured again once webfonts settle: the text height is not final on the
  // first paint.
  useEffect(() => {
    void document.fonts?.ready.then(fitDescription);
  }, [fitDescription]);

  const descriptionHtml = useMemo(
    () => renderMarkdown(item?.description ?? ''),
    [item?.description],
  );

  if (!item) return null;

  const priority = toDisplayPriority(item.priority);
  const due = dueDate(item);
  const deadline = deadlineDate(item);
  const subtasks = childrenOf(item.id);
  const { minutes, computed } = effectiveEstimate(item, childrenOf);
  /* The parents above this task, outermost first. Guarded against a cycle the
     server should never send but which would otherwise hang the panel. */
  const ancestors: Item[] = [];
  for (
    let parent = item.parent_id ? snapshot.items[item.parent_id] : null;
    parent && ancestors.length < 10;
    parent = parent.parent_id ? snapshot.items[parent.parent_id] : null
  ) {
    ancestors.unshift(parent);
  }

  const project = snapshot.projects[item.project_id];
  const section = item.section_id ? snapshot.sections[item.section_id] : null;
  const comments = Object.values(snapshot.notes)
    .filter((n) => n.item_id === item.id)
    .sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  const visibleLabels = item.labels.filter((l) => !l.toLowerCase().startsWith('est-'));
  const allTags = Object.values(snapshot.labels)
    .filter((l) => !l.is_deleted && !l.name.startsWith('est-'))
    .sort(byLabelOrder);
  const filteredTags = allTags.filter((label) => matchesSearch(label.name, tagQuery));

  const toggleTag = (name: string) => void updateTask(item.id, {
    labels: item.labels.includes(name)
      ? item.labels.filter((label) => label !== name)
      : [...item.labels, name],
  });

  /**
   * Saves the title, and everything the title turned out to be saying.
   *
   * Typing "call the plumber tomorrow p1 #Home" into a task's name should do
   * what typing it into the composer does. What the readers claim is taken out
   * of the name and written to the field it belongs to; what they do not claim
   * stays in the name exactly as it was typed.
   */
  /** Whether the title holds an edit that has not been saved yet. */
  const titleDirty = title !== item.content;

  /* Both ways out of an edit also let the field go: a title that has just been
     saved is not being edited any more, and a box still wearing its focus ring
     says it is. */
  const releaseTitle = () => { titleRef.current?.blur(); };

  const cancelTitle = () => {
    setTitle(item.content);
    setRefusals([]);
    releaseTitle();
  };

  const commitTitle = () => {
    const read = parseShorthand(title, snapshot, naturalDates, refusals);
    const next = read.content.trim();
    if (!next) {
      // Nothing left to call it by: the edit is dropped rather than the name.
      setTitle(item.content);
      return;
    }

    const fields: Record<string, unknown> = {};
    if (next !== item.content) fields.content = next;
    if (read.date) fields.due = dueForDate(item.due, read.date);
    if (read.priority) fields.priority = toTodoistPriority(read.priority);

    let labels = item.labels;
    if (read.labels.length > 0) labels = [...new Set([...labels, ...read.labels])];
    if (read.minutes !== null) labels = withEstimate(labels, read.minutes);
    if (labels !== item.labels) fields.labels = labels;

    if (Object.keys(fields).length > 0) void updateTask(item.id, fields);

    /* A repeat is not an `item_update` field like the others: Todoist resolves
       the rule, so it is sent on its own and the date is left to it. */
    if (read.recurrence) void setRecurrence(item.id, read.recurrence);

    const movingProject = read.projectId && read.projectId !== item.project_id;
    const movingSection = read.sectionId && read.sectionId !== item.section_id;
    if (movingProject || movingSection) {
      void moveTask(
        item.id,
        read.sectionId ? { section_id: read.sectionId } : { project_id: read.projectId! },
      );
    }

    /*
     * What the title turned out to be saying, said back.
     *
     * The words are taken out of the name as they are saved, so a title typed
     * "… demain" and saved comes back one word shorter — which on its own is
     * indistinguishable from the edit having been thrown away. The line names
     * what was set instead, and the panel on the right shows it.
     */
    const applied = [
      read.date
        ? formatRelativeDay(new Date(`${read.date.slice(0, 10)}T00:00:00`), locale)
          + (read.date.includes('T') ? ` ${read.date.slice(11, 16)}` : '')
        : null,
      read.recurrence?.string ?? null,
      read.projectId ? snapshot.projects[read.projectId]?.name ?? null : null,
      read.priority ? `P${read.priority}` : null,
      ...read.labels.map((label) => `@${label}`),
      read.minutes !== null ? formatDuration(read.minutes, locale) : null,
    ].filter(Boolean);
    if (applied.length > 0) toast(applied.join(' · '));

    setRefusals([]);
    setTitle(next);
    releaseTitle();
  };
  const commitDescription = () => {
    setEditingDescription(false);
    if (description !== item.description) void updateTask(item.id, { description });
  };

  function addSubtask() {
    const content = subtaskDraft.trim();
    if (!content) {
      setAddingSubtask(false);
      return;
    }
    void createTask({ content, project_id: item!.project_id, parent_id: item!.id });
    setSubtaskDraft('');
  }

  return (
    <Overlay open onClose={onClose} label={t('detail.title')}>
      <header className="detail-top">
        {/*
          * Where the task is, as the way back rather than as a caption.
          *
          * A subtask opened from its parent used to be a dead end: the panel
          * said which project it was in and nothing about the task it belongs
          * to, and closing was the only way back up. Each ancestor is a link
          * now, the project included. The section is not one, because there is
          * no page that is a section.
          */}
        <nav className="crumb" aria-label={t('detail.whereItIs')}>
          {project && (
            <button
              className="crumblink"
              onClick={() => { onClose(); navigate('project', project.id); }}
            >
              <span className="hash" style={markerStyle(project.color)}>#</span>
              {project.name}
            </button>
          )}
          {section && (
            <>
              <span className="crumb-sep">/</span>
              <span className="crumbhere">{section.name}</span>
            </>
          )}
          {ancestors.map((parent) => (
            <span className="crumbstep" key={parent.id}>
              <span className="crumb-sep">/</span>
              <button className="crumblink" onClick={() => onOpen(parent.id)}>
                {parent.content}
              </button>
            </span>
          ))}
          {/* The task's own name ends the trail. On a phone it is dropped:
              the headline two lines below says it already, and said twice in
              a column 375px wide it is the whole top of the panel spent on
              one sentence. */}
          <span className="crumbstep crumbself">
            <span className="crumb-sep">/</span>
            <span className="crumbhere" aria-current="page">{displayTaskContent(item)}</span>
          </span>
        </nav>

        <div className="detail-tools">
          <div className="menuwrap">
            <button
              className="iconbtn"
              aria-label={t('task.moreActions')}
              title={t('task.moreActions')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Icon name="more" />
            </button>
            {menuOpen && (
              <div className="popover rowmenu" role="menu" ref={menuRef}>
                <button
                  className="opt"
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(todoistTaskUrl(item.id), '_blank', 'noopener');
                  }}
                >
                  <span><Icon name="external" size="sm" /> {t('task.openInTodoist')}</span>
                </button>
                {!demo && !isTemporaryId(item.id) && (
                  <button
                    className="opt"
                    onClick={() => {
                      setMenuOpen(false);
                      void copyText(todoistTaskUrl(item.id))
                        .then((ok) => toast(t(ok ? 'task.linkCopied' : 'task.linkNotCopied')));
                    }}
                  >
                    <span><Icon name="link" size="sm" /> {t('task.copyLink')}</span>
                  </button>
                )}
                <hr />
                <button className="opt danger" onClick={askThenDelete}>
                  <span><Icon name="close" size="sm" /> {t('task.delete')}</span>
                </button>
              </div>
            )}
          </div>

          <button className="iconbtn" aria-label={t('detail.close')} title={t('detail.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div className="detail-body" ref={panelRef}>
        <div className="detail-main">
          <div className={`detail-headline${item.checked ? ' done' : ''}`}>
            {isUncompletable(item) ? (
              <span className={`check p${priority} nocheck`} aria-hidden="true" />
            ) : (
              <span
                className={`check p${priority}`}
                role="checkbox"
                aria-checked={item.checked}
                aria-label={t('task.complete')}
                tabIndex={0}
                onClick={() => void toggleTask(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void toggleTask(item.id);
                  }
                }}
              >
                <Icon name="check" />
              </span>
            )}

            <div className="detail-content">
              {/* The same field the composer uses, so a title edited here
                  reads what a title typed there reads: a date, a repeat, a
                  project, a tag, a priority — marked as you type and taken out
                  of the name when it is saved. */}
              <TaskNameField
                value={title}
                onChange={setTitle}
                onSubmit={commitTitle}
                onCancel={cancelTitle}
                placeholder={t('detail.title')}
                ariaLabel={t('detail.title')}
                snapshot={snapshot}
                naturalDates={naturalDates}
                refusals={refusals}
                onRefusals={setRefusals}
                multiline
                fieldClassName="titlefield"
                fieldRef={titleRef}
              />

              {/*
                * An edit to the title is finished on purpose.
                *
                * It used to save itself when the field lost the caret, which
                * is fine for a name and wrong for a name that also carries a
                * date, a project and a priority: clicking anywhere rewrote
                * four things at once, and the panel on the right only caught
                * up afterwards. Enter saves, Escape puts it back, and the two
                * buttons say so for anyone who does neither.
                */}
              {titleDirty && (
                <div className="titleactions">
                  {/* Pressed before the field can lose the caret, or the blur
                      would land on the field and the click on nothing. */}
                  <button
                    className="btn sm"
                    onMouseDown={(e) => { e.preventDefault(); cancelTitle(); }}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    className="btn sm primary"
                    onMouseDown={(e) => { e.preventDefault(); commitTitle(); }}
                  >
                    {t('common.save')}
                  </button>
                </div>
              )}

              {editingDescription ? (
                <textarea
                  ref={descriptionRef}
                  className="descfield"
                  value={description}
                  placeholder={t('detail.descriptionPlaceholder')}
                  aria-label={t('detail.description')}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={commitDescription}
                  onKeyDown={(e) => {
                    /* Escape leaves the field, and leaving the field saves —
                       the same thing clicking away from it does. It used to
                       throw the edit away and take the whole panel with it,
                       which is two surprises for one key. Nothing typed here
                       is ever discarded, so Escape and clicking away agree.
                       Cmd+Enter is the same act, said deliberately. */
                    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                      e.preventDefault();
                      e.stopPropagation();
                      commitDescription();
                      // The panel keeps the keyboard; only the field gives it up.
                      descriptionRef.current?.blur();
                    }
                  }}
                />
              ) : (
                <button
                  className={`descview${item.description ? '' : ' placeholder'}`}
                  onClick={() => setEditingDescription(true)}
                  aria-label={t('detail.description')}
                >
                  {item.description ? (
                    <div className="md" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
                  ) : (
                    t('detail.descriptionPlaceholder')
                  )}
                </button>
              )}
            </div>
          </div>

          <section className="detail-section boxed">
            <h3 className="sectionlabel">
              {t('detail.subtasks')}
              {subtasks.length > 0 && (
                <span className="count">
                  {t('task.subtaskProgress', {
                    done: subtasks.filter((c) => c.checked).length,
                    total: subtasks.length,
                  })}
                </span>
              )}
            </h3>

            {subtasks.map((child) => <EditableSubtask child={child} onOpen={onOpen} key={child.id} />)}

            {addingSubtask ? (
              <input
                className="textfield"
                autoFocus
                placeholder={t('detail.addSubtask')}
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onBlur={() => { addSubtask(); setAddingSubtask(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSubtask();
                  }
                  if (e.key === 'Escape') {
                    setSubtaskDraft('');
                    setAddingSubtask(false);
                  }
                }}
              />
            ) : (
              <button className="addline" onClick={() => setAddingSubtask(true)}>
                <Icon name="plus" size="sm" />
                {t('detail.addSubtask')}
              </button>
            )}
          </section>

          <section className="detail-section boxed">
            <h3 className="sectionlabel">{t('detail.comments')}</h3>
            {comments.length === 0 ? (
              <p className="psub">{t('detail.noComments')}</p>
            ) : (
              comments.map((note) => (
                <article className="comment" key={note.id}>
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
                  <time className="psub">{formatRelativeDay(new Date(note.posted_at), locale)}</time>
                </article>
              ))
            )}
          </section>
        </div>

        <aside className="detail-side">
          {/* The section belongs here with the project rather than being left
              to the breadcrumb: this is the panel a task is edited in, and
              where it lives was the one property it could read but not change.
              A move, not an update — `item_update` takes neither a project nor
              a section, so the field used to move the task on screen only. */}
          <div className="prop" data-prop="project">
            <PropLabel name={t('detail.project')} prop="project" />
            <PlacementField
              ariaLabel={t('detail.project')}
              value={{ projectId: item.project_id, sectionId: item.section_id }}
              onChange={(place) => void moveTask(
                item.id,
                place.sectionId
                  ? { section_id: place.sectionId }
                  : { project_id: place.projectId },
              )}
            />
          </div>

          <div className="prop" data-prop="start">
            <PropLabel name={t('detail.startDate')} prop="start" />
            <DateField
              value={due ? toApiDate(due) : ''}
              label={t('detail.startDate')}
              placeholder={t('date.pick')}
              onChange={(value) => {
                /* Keeps the rule. Writing the date into `due.string` is what
                   ends a series, and picking a day in a calendar is never a
                   request to stop something repeating — the field below is. */
                void updateTask(item.id, {
                  due: value ? dueForDate(item.due, value) : null,
                });
              }}
            />
            {/* The row's own schedule menu has offered this for a while
                (TaskActions.tsx) — closing the panel to reach it, just to skip
                one occurrence of the task already open, was the gap. */}
            {item.due?.is_recurring && (
              <button
                type="button"
                className="proplink"
                title={t('task.nextOccurrenceHint')}
                onClick={() => void skipOccurrence(item.id)}
              >
                <Icon name="repeat" size="sm" />
                {t('task.nextOccurrence')}
              </button>
            )}
          </div>

          <div className="prop" data-prop="deadline">
            <PropLabel name={t('detail.deadline')} prop="deadline" />
            <DateField
              value={deadline ? toApiDate(deadline) : ''}
              label={t('detail.deadline')}
              placeholder={t('date.pick')}
              onChange={(value) =>
                void updateTask(item.id, { deadline: value ? { date: value, lang: locale } : null })}
            />
          </div>

          <div className="prop" data-prop="estimate">
            <PropLabel name={t('detail.estimate')} prop="estimate" />
            {/* The same field as everywhere else, so the unit is always beside
                the number instead of being left to the reader to infer. */}
            <EstimateField
              minutes={computed ? null : minutes}
              placeholder={
                computed && minutes !== null
                  ? `${formatDuration(minutes, locale)} · ${t('task.computedEstimate')}`
                  : t('task.estimatePlaceholder')
              }
              onCommit={(value) =>
                void updateTask(item.id, { labels: withEstimate(item.labels, value) })}
            />
          </div>

          <div className="prop" data-prop="priority">
            <PropLabel name={t('detail.priority')} prop="priority" />
            <Select
              value={String(priority)}
              ariaLabel={t('detail.priority')}
              onChange={(next) =>
                void updateTask(item.id, {
                  priority: toTodoistPriority(Number(next) as DisplayPriority),
                })}
              options={([1, 2, 3, 4] as const).map((p) => ({
                value: String(p), label: `P${p}`,
              }))}
            />
          </div>

          <div className="prop" data-prop="tags">
            <span className="prophead">
              <PropLabel name={t('detail.labels')} prop="tags" />
              <button
                className="propadd"
                aria-label={t('composer.labels')}
                title={t('composer.labels')}
                aria-expanded={tagPickerOpen}
                onClick={() => setTagPickerOpen((openNow) => {
                  if (!openNow) setTagQuery('');
                  return !openNow;
                })}
              >
                <Icon name="plus" size="sm" />
              </button>
            </span>

            <div className="pills">
              {visibleLabels.length === 0 && <span className="psub">{t('common.none')}</span>}
              {visibleLabels.map((label) => {
                const known = Object.values(snapshot.labels).find((l) => l.name === label);
                return (
                  <button
                    key={label}
                    className="pill"
                    title={t('detail.labels')}
                    onClick={() =>
                      void updateTask(item.id, { labels: item.labels.filter((l) => l !== label) })
                    }
                  >
                    <Icon name="tag" size="sm" className="taglabel" style={markerStyle(known?.color, false)} />
                    <span>{label}</span>
                    <Icon name="close" size="sm" />
                  </button>
                );
              })}
            </div>

            {tagPickerOpen && (
              <div
                className="popover tagpicker"
                role="dialog"
                aria-label={t('composer.labels')}
                /* The tags property sits at the foot of a scrolling panel, so
                   the list it opens can land below the fold. Bring it up. */
                ref={(node) => node?.scrollIntoView({ block: 'nearest' })}
              >
                <div className="pickersearch">
                  <Icon name="search" size="sm" />
                  <input
                    autoFocus
                    value={tagQuery}
                    placeholder={t('nav.search')}
                    aria-label={t('nav.search')}
                    onChange={(event) => setTagQuery(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter' && filteredTags[0]) {
                        event.preventDefault();
                        toggleTag(filteredTags[0].name);
                      }
                      if (event.key === 'Escape') setTagPickerOpen(false);
                    }}
                  />
                </div>
                {allTags.length === 0 && <p className="menuhint">{t('labels.none')}</p>}
                {allTags.length > 0 && filteredTags.length === 0 && <p className="menuhint">{t('search.noResults')}</p>}
                {filteredTags.map((label) => (
                  <label className="checkrow" key={label.id}>
                    <input
                      type="checkbox"
                      checked={item.labels.includes(label.name)}
                      onChange={() => toggleTag(label.name)}
                    />
                    <Icon name="tag" size="sm" className="taglabel" style={markerStyle(label.color, false)} />
                    <span>{label.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="prop">
            <span>{t('detail.recurring')}</span>
            <RecurrenceField item={item} />
          </div>
        </aside>
      </div>
    </Overlay>
  );
}
