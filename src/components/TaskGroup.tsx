import { useEffect, useState, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Icon } from './Icon';
import { DraggableTask } from './dnd/DraggableTask';
import { Droppable } from './dnd/Droppable';
import type { DropTarget, RowOrder } from '@/domain/dnd';
import { RowListContext } from './dnd/RowList';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { TaskRow } from './TaskRow';
import { formatDuration, effectiveEstimate } from '@/domain/estimates';
import type { Item } from '@/domain/types';

interface TaskGroupProps {
  title?: string;
  items: Item[];
  childrenOf: (id: string) => Item[];
  onOpen: (id: string) => void;
  /** Extra visual weight for Behind schedule and Quick. */
  tint?: 'late' | 'quick';
  actions?: ReactNode;
  showProject?: boolean;
  defaultCollapsed?: boolean;
  /** Adds a task straight into this section. */
  onAddTask?: () => void;
  /**
   * Which of Todoist's orders this list is kept in, when a task can be dropped
   * into a place in it. Left out, the rows take no drop of their own.
   */
  reorderable?: RowOrder;
  /** The page this group is on, so a drop can make its order the view's own. */
  viewKey?: string;
  /** Stays on the page with nothing in it, so the line that fills it is there. */
  keepWhenEmpty?: boolean;
  /** An accent for the sections that carry meaning: late, and quick. */
  accent?: 'late' | 'quick';
  /** When set, the whole group accepts tasks dropped onto it. */
  dropTarget?: DropTarget;
  /** A real section can be renamed, moved and deleted; a derived grouping cannot. */
  sectionId?: string;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  /** Decision views can reuse rows while explicitly forbidding drag semantics. */
  draggable?: boolean;
}

export function TaskGroup({
  title, items, childrenOf, onOpen, tint, actions,
  showProject = true, defaultCollapsed = false, dropTarget, onAddTask, accent,
  sectionId, onRename, onDelete, reorderable, viewKey, keepWhenEmpty = false, draggable = true,
}: TaskGroupProps) {
  const { t, locale } = useT();
  const dragging = useStore((s) => s.draggingTaskId !== null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // An empty derived grouping is noise. A real section is not: it is somewhere
  // you chose to make, and a section you just created has to be visible before
  // it can be named or filled. Nor is the project's own block above its first
  // section: empty, it is still the only way to add a task outside them.
  if (items.length === 0 && !sectionId && !keepWhenEmpty && !(dropTarget && dragging)) return null;

  const totalMinutes = items.reduce(
    (acc, item) => acc + (effectiveEstimate(item, childrenOf).minutes ?? 0),
    0,
  );

  // The meaning stays in the heading's colour rather than a panel behind it.
  const mark = accent ?? tint;
  const className = `group${mark === 'late' ? ' accent-late' : mark === 'quick' ? ' accent-quick' : ''}`;

  const body = (isOver: boolean) => (
    <section
      className={`${className}${sectionId ? ' has-section-slots' : ''}${isOver ? ' dropping' : ''}`}
      /* The tour points at these by name rather than by class, so renaming a
         class cannot silently leave it highlighting the wrong thing. */
      data-tour={mark === 'quick' ? 'quick' : undefined}
    >
      {sectionId && <SectionDropSlots id={sectionId} />}
      {/* A section just created has no name yet, and it is the heading that
          carries the field you name it in. */}
      {(title || sectionId) && (
        <div className="gheadblock">
        <div className="ghead">
          {/* A section is dragged by its own handle, so a click on the heading
              still collapses it. */}
          {sectionId && <SectionHandle id={sectionId} label={t('section.move')} />}
          <button
            className="gtoggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {onRename && sectionId ? (
              <SectionName
                id={sectionId}
                value={title ?? ''}
                placeholder={t('section.untitled')}
                label={t('section.name')}
                onRename={onRename}
              />
            ) : (
              <span className="gname">{title}</span>
            )}
            {totalMinutes > 0 && <span className="gtime">{formatDuration(totalMinutes, locale)}</span>}
          </button>
          {actions && <span className="gactions">{actions}</span>}
          <span className="gcount">{items.length}</span>
          {onDelete && (
            <button
              className="gdelete"
              aria-label={t('section.delete')}
              title={t('section.delete')}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Icon name="close" size="sm" />
            </button>
          )}
          {/* The disclosure caret ends the row, as it does in the sidebar. */}
          <button
            className="gdisclose"
            aria-expanded={!collapsed}
            aria-label={title}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon name={collapsed ? 'caret' : 'caret-up'} size="sm" />
          </button>
        </div>

        </div>
      )}

      {!collapsed &&
        items.map((item) => draggable ? (
          <DraggableTask
            key={item.id}
            item={item}
            childrenOf={childrenOf}
            onOpen={onOpen}
            showProject={showProject}
          />
        ) : (
          <TaskRow
            key={item.id}
            item={item}
            childrenOf={childrenOf}
            onOpen={onOpen}
            showProject={showProject}
          />
        ))}

      {/* A block with no heading has nothing to say it is empty about: the
          add line under it is the whole point of it being there. */}
      {!collapsed && items.length === 0 && (title || sectionId) && (
        <p className="empty">{t('group.empty')}</p>
      )}

      {!collapsed && onAddTask && (
        <button className="addline sectionadd" onClick={onAddTask}>
          <Icon name="plus" size="sm" />
          {t('nav.addTaskHere')}
        </button>
      )}
    </section>
  );

  /* Everything a row needs to answer a drop: how this list is numbered, what
     is in it, and what the list itself means for a task arriving from
     somewhere else. */
  const list = reorderable
    ? { order: reorderable, ids: items.map((item) => item.id), target: dropTarget, viewKey }
    : null;
  const wrapped = (isOver: boolean) => (
    <RowListContext.Provider value={list}>{body(isOver)}</RowListContext.Provider>
  );

  if (!dropTarget) return wrapped(false);
  /* Several sections can offer the same destination — Behind schedule, Quick
     and Today all mean "today" — and droppables sharing an id all report
     themselves as hovered at once. The title separates them. */
  return (
    <Droppable target={dropTarget} scope={`group:${sectionId ?? title ?? ''}`}>
      {/* A section being reordered passes over the groups too, and only the
          seams between them are its destinations. */}
      {({ isOver }) => wrapped(isOver && dragging)}
    </Droppable>
  );
}

/** The upper and lower halves of a real section are explicit reorder targets. */
function SectionDropSlots({ id }: { id: string }) {
  const dragging = useStore((s) => s.draggingSectionId);
  const disabled = !dragging || dragging === id;
  const before = useDroppable({ id: `section-slot:${id}:before`, disabled });
  const after = useDroppable({ id: `section-slot:${id}:after`, disabled });

  return (
    <>
      <span
        ref={before.setNodeRef}
        className={`section-position before${before.isOver ? ' over' : ''}`}
        aria-hidden="true"
      />
      <span
        ref={after.setNodeRef}
        className={`section-position after${after.isOver ? ' over' : ''}`}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * A section's name, typed where it is read.
 *
 * The field is sized from its own text rather than filling the row: a field
 * that stretches pushes the duration and the count halfway across the page for
 * no reason.
 */
function SectionName({
  id, value, placeholder, label, onRename,
}: {
  id: string;
  value: string;
  placeholder: string;
  label: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <input
      className="gname gnamefield"
      data-section-name={id}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      size={Math.max(placeholder.length, draft.length + 1)}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      /* An emptied name is put back rather than sent: Todoist refuses a
         section with no name. */
      onBlur={() => {
        if (!draft.trim()) setDraft(value);
        else if (draft.trim() !== value) onRename(draft.trim());
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

/** The grip a section is dragged by. */
function SectionHandle({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `section:${id}` });
  return (
    <span
      ref={setNodeRef}
      className="sectiondrag"
      title={label}
      aria-label={label}
      {...attributes}
      {...listeners}
    >
      <Icon name="drag" size="sm" />
    </span>
  );
}
