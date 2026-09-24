import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { Modifier } from '@dnd-kit/core';
import { useStore } from '@/store/store';
import {
  canNest, decodeRowTarget, decodeTarget, dropMutation, moveArgs, siblingTasks,
  type DropTarget,
} from '@/domain/dnd';
import { formatDayOrName } from '@/domain/dates';
import {
  relativePositionFromCenters, reorderAtSlot, reorderRelative,
} from '@/domain/order';
import { useT } from '@/hooks/useT';
import { siblingOrder } from '@/store/selectors';
import { SUBTASK_DRAG_PREFIX } from '@/components/TaskRow';
import {
  TAG_DRAG_PREFIX, TAG_DROP_PREFIX, TAG_TOP_DROP_ID, tagOrderFor,
} from '@/components/dnd/DraggableTag';
import { updateItem, moveItem, reorderItems, updateDayOrders } from '@/api/commands';
import type { Item } from '@/domain/types';
import { markerStyle } from '@/domain/colors';
import { Icon } from '@/components/Icon';
import {
  type RowList, TASK_DROP_EVENT, TASK_PLACE_EVENT, type TaskDropRequest, type TaskPlaceRequest,
} from './RowList';
import { usePhoneBehaviour } from '@/hooks/useTouchLayout';
import { PRESS_HOLD_EVENT, projectRowAttr } from './ProjectRowSortable';
import { byChildOrder, bySectionOrder, keyBetween, keysInOrder } from '@/domain/orderKey';

/**
 * Puts the preview under the pointer by its left edge rather than its centre.
 *
 * Centred, the card covers the cursor and you cannot see what you are aiming
 * at; anchored left, the pointer leads and the destination stays readable.
 */
const anchorLeftOfCursor: Modifier = ({
  activatorEvent, activeNodeRect, draggingNodeRect, transform,
}) => {
  if (!draggingNodeRect || !activeNodeRect || !activatorEvent) return transform;
  const { clientX, clientY } = activatorEvent as PointerEvent;
  return {
    ...transform,
    x: transform.x + clientX - activeNodeRect.left - 12,
    y: transform.y + clientY - activeNodeRect.top - draggingNodeRect.height / 2,
  };
};

/**
 * What is being dragged, and what will take it.
 *
 * Four different things are dragged in this app and they are not
 * interchangeable: a task goes to a destination, a section into a slot, a
 * sidebar project onto another row, a subtask onto one of its siblings. They
 * all share one drag context, so every droppable in the app is a candidate for
 * every drag — and a drop is decided by where the pointer is, which means a
 * region of the page behind a dialog can win a drop aimed at a row inside it.
 * Each drag is therefore only offered what it could possibly mean.
 */
/**
 * A drag that was a press held still: it never became a pull.
 *
 * Only reachable where the drag waits for the press to be held, which is the
 * phone rule — under the desktop rule a drag cannot start without movement, so
 * this can never be true there.
 */
const pressedAndHeld = (event: DragEndEvent): boolean =>
  Math.abs(event.delta.x) < HOLD_SLOP_PX && Math.abs(event.delta.y) < HOLD_SLOP_PX;

const dragKind = (id: string): 'subtask' | 'section' | 'project' | 'tag' | 'task' =>
  (id.startsWith('subtask:') ? 'subtask'
    : id.startsWith('section:') ? 'section'
      : id.startsWith('project-row:') ? 'project'
        : id.startsWith(TAG_DRAG_PREFIX) ? 'tag' : 'task');

const dropKind = (id: string): 'subtask' | 'slot' | 'project' | 'tag' | 'target' =>
  (id.startsWith('subtask:') ? 'subtask'
    : id.startsWith('slot:') || id.startsWith('section-slot:') ? 'slot'
      : id.startsWith('project-row:') || id.startsWith('project-slot:') ? 'project'
        : id.startsWith(TAG_DROP_PREFIX) ? 'tag' : 'target');

const ACCEPTS: Record<ReturnType<typeof dragKind>, Array<ReturnType<typeof dropKind>>> = {
  subtask: ['subtask'],
  section: ['slot'],
  /* A sidebar row is both a position in the list and a project destination,
     and a project dragged onto either means the same landing. */
  project: ['project', 'target'],
  /* A tag is not a position in any list and not a destination for anything.
     The one place it can go is Favourites. */
  tag: ['target', 'tag'],
  task: ['target'],
};

/**
 * Where the pointer is, among the places this drag could actually land.
 *
 * Collisions are decided by the cursor rather than by overlap, because a task
 * row is as wide as the page and by area it always beat the narrow sidebar
 * destinations.
 */
const collisionsForKind: CollisionDetection = (args) => {
  const accepted = ACCEPTS[dragKind(String(args.active.id))];
  const hits = pointerWithin(args).filter(
    (collision) => accepted.includes(dropKind(String(collision.id))),
  );
  /* A row lies inside the droppable of its group, so the pointer is within
     both; the row is the narrower, deliberate answer. */
  const rows = hits.filter((c) => decodeRowTarget(String(c.id)) !== null);
  if (rows.length) return rows;

  const nearestVertical = (choices: typeof hits) => {
    const pointer = args.pointerCoordinates;
    if (!pointer) return choices;
    return [...choices].sort((a, b) => {
      const aRect = args.droppableRects.get(a.id);
      const bRect = args.droppableRects.get(b.id);
      const aDistance = aRect ? Math.abs(pointer.y - (aRect.top + aRect.height / 2)) : Infinity;
      const bDistance = bRect ? Math.abs(pointer.y - (bRect.top + bRect.height / 2)) : Infinity;
      const distance = aDistance - bDistance;
      if (distance !== 0) return distance;
      /* The exact centre is the common mouse target. On a tie, taking the
         upper seam makes dragging the lower sibling onto the upper one do the
         unsurprising thing instead of producing the unchanged order. */
      return String(a.id).endsWith(':before') ? -1 : 1;
    }).slice(0, 1);
  };

  if (dragKind(String(args.active.id)) === 'section') {
    const positions = hits.filter((c) => String(c.id).startsWith('section-slot:'));
    if (positions.length) return nearestVertical(positions);
  }

  /* A project has one stable target: its whole row. The position is derived
     from the dragged row's centre at release. This avoids competing nested
     droppables, which made a project appear to land but left the order
     unchanged. Moving right still turns the same target into nesting. */
  if (dragKind(String(args.active.id)) === 'project') {
    const projectSlots = hits.filter((c) => String(c.id).startsWith('project-slot:'));
    if (projectSlots.length) return nearestVertical(projectSlots);
    const projectRows = hits.filter((c) => String(c.id).startsWith('project-row:'));
    if (projectRows.length) return nearestVertical(projectRows);
  }

  /* A row is picked up by a handle drawn outside it, in the gutter, so a task
     dragged straight down the list is carried by a pointer that is beside
     every row and inside none of them — and the list it is being reordered in
     could never see it. Each row answers for its own gutter. */
  const pointer = args.pointerCoordinates;
  if (pointer && accepted.includes('target')) {
    const beside = args.droppableContainers.filter((container) => {
      if (decodeRowTarget(String(container.id)) === null) return false;
      const rect = args.droppableRects.get(container.id);
      return rect !== undefined
        && pointer.y >= rect.top && pointer.y <= rect.top + rect.height
        && pointer.x >= rect.left - HANDLE_GUTTER_PX && pointer.x <= rect.left + rect.width;
    });
    if (beside.length) return beside.map((container) => ({ id: container.id }));
  }
  return hits;
};

/** How far to the left of a row its own drag handle is drawn. */
const HANDLE_GUTTER_PX = 36;

/**
 * When the last drag ended, for the click that a browser fires on a drop.
 *
 * A pointer that goes down and comes up inside the same element produces a
 * click, drag or no drag, so a card dropped back where it started would open.
 */
export const dragClock = {
  endedAt: 0,
  justEnded: () => Date.now() - dragClock.endedAt < 250,
};

/**
 * How long a finger has to stay still before a row lifts.
 *
 * Long enough that scrolling never trips it — a scroll has moved well past the
 * slop by then, and moving is what calls the hold off — and short enough that
 * picking a project up does not feel like waiting for permission. It is also
 * the press that opens a project's menu, so both are measured by the one
 * duration.
 */
export const HOLD_MS = 240;

/**
 * How far a finger may stray during that hold and still be holding.
 *
 * Past it the press was a scroll, and the drag is called off rather than
 * started.
 */
const HOLD_SLOP_PX = 8;

/**
 * How far right a sidebar project, or a task row, has to be dragged before the
 * drop nests it rather than reordering or moving it.
 *
 * The same gesture means two things, told apart by direction: straight down
 * the list moves it, out to the right puts it inside. It is the indent every
 * outliner uses, and it costs no second handle and no modifier key.
 */
export const NEST_THRESHOLD_PX = 28;

/** A dragged item's task id, whether it was picked up as a row or a subtask. */
const taskIdOf = (activeId: string): string =>
  activeId.startsWith(SUBTASK_DRAG_PREFIX) ? activeId.slice(SUBTASK_DRAG_PREFIX.length) : activeId;

/**
 * Drag and drop across the whole app.
 *
 * A drop is translated by the rules in `domain/dnd`, applied optimistically,
 * and offered back as an undo, because dragging is easy to do by accident.
 */
export function DragProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const dateFormat = useStore((s) => s.prefs.dateFormat);
  const apply = useStore((s) => s.apply);
  const toast = useStore((s) => s.toast);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const setDragging = useStore((s) => s.setDragging);
  const moveSection = useStore((s) => s.moveSection);
  const reorderProjects = useStore((s) => s.reorderProjects);
  const reorderSubtasks = useStore((s) => s.reorderSubtasks);
  const setDraggingSection = useStore((s) => s.setDraggingSection);
  const nestProject = useStore((s) => s.nestProject);
  const updateProjectFields = useStore((s) => s.updateProjectFields);
  const setLabelFavourite = useStore((s) => s.setLabelFavourite);
  const reorderLabels = useStore((s) => s.reorderLabels);
  const setNesting = useStore((s) => s.setNesting);
  const setDraggingProject = useStore((s) => s.setDraggingProject);
  const setDraggingTag = useStore((s) => s.setDraggingTag);
  /** A subtask pulled out to the left: on release it becomes a task of its own. */
  const outdenting = useStore((s) => s.outdenting);
  const setOutdenting = useStore((s) => s.setOutdenting);
  const setViewPrefs = useStore((s) => s.setViewPrefs);

  /**
   * A drag starts on distance on a desktop and on time on a phone.
   *
   * One rule served both and began a drag as soon as anything moved six
   * pixels. On a desktop that is right: a press and a pull has nothing else it
   * could mean. On a phone a press and a pull is how you scroll, so every
   * attempt to scroll the sidebar picked a project up and carried it off —
   * the list moving under the thumb was a project being filed somewhere
   * rather than the list scrolling.
   *
   * So on a phone the press has to be held. Move before it is and it was a
   * scroll; hold still and the row lifts, which is the gesture every phone
   * already uses to mean "this one" — and letting go of it without moving is
   * how the project's menu opens.
   */
  const phone = usePhoneBehaviour();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: phone
        ? { delay: HOLD_MS, tolerance: HOLD_SLOP_PX }
        : { distance: 6 },
    }),
  );

  /**
   * What the drop did, in the fewest words that still tell it from the others.
   *
   * The toast is the only account of a drop, and a drop landing a few pixels
   * off does something different from what was meant — so the one thing it has
   * to carry is which of the things it could have done it actually did. The
   * task's own title is no help there: every drop of the same task reads the
   * same.
   */
  function whatHappened(target: DropTarget): string | null {
    switch (target.kind) {
      case 'today':
        return t('drop.toDay', { day: t('common.today') });
      case 'day':
        return t('drop.toDay', { day: formatDayOrName(target.date, locale, dateFormat) });
      case 'quick':
        return t('drop.quick');
      case 'anytime':
        return t('drop.anytime');
      case 'someday':
        return t('drop.someday');
      case 'project':
        return t('drop.toProject', { name: snapshot.projects[target.projectId]?.name ?? '' });
      /* A section drop names the section; a drop above the first one is a drop
         on the project, and says so. */
      case 'section':
        return target.sectionId
          ? t('drop.toSection', { name: snapshot.sections[target.sectionId]?.name ?? '' })
          : t('drop.toProject', { name: snapshot.projects[target.projectId]?.name ?? '' });
      case 'label':
        return t('drop.tagged', { label: target.label });
      default:
        return null;
    }
  }

  /** Where a task landed when it followed a row into another list. */
  /** What a group drop names in its toast: "3 tasks moved to {this}". */
  function groupDestination(target: DropTarget): string {
    switch (target.kind) {
      case 'today': return t('common.today');
      case 'day': return formatDayOrName(target.date, locale, dateFormat);
      case 'quick': return t('group.quick');
      case 'anytime': return t('group.anytime');
      case 'someday': return t('nav.someday');
      case 'label': return `@${target.label}`;
      case 'project': return snapshot.projects[target.projectId]?.name ?? '';
      case 'section': {
        const project = snapshot.projects[target.projectId]?.name ?? '';
        const section = target.sectionId ? snapshot.sections[target.sectionId]?.name : null;
        return section ? `${project} / ${section}` : project;
      }
      default: return '';
    }
  }

  function whereItLanded(container: { project_id: string; section_id: string | null }): string {
    return container.section_id
      ? t('drop.toSection', { name: snapshot.sections[container.section_id]?.name ?? '' })
      : t('drop.toProject', { name: snapshot.projects[container.project_id]?.name ?? '' });
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const isSection = id.startsWith('section:');
    const isProject = id.startsWith('project-row:');
    const isSubtask = id.startsWith('subtask:');
    setDraggingId(id);
    /* None of these is a task being filed somewhere, so the "a task is in
       flight" flag stays down and the empty drop zones stay closed. A subtask
       being reordered is moving inside its parent, not out of it. */
    setDragging(isSection || isProject || isSubtask ? null : taskIdOf(id));
    setDraggingSection(isSection ? id.slice('section:'.length) : null);
    setDraggingProject(isProject ? id.slice('project-row:'.length) : null);
    setDraggingTag(id.startsWith(TAG_DRAG_PREFIX) ? id.slice(TAG_DRAG_PREFIX.length) : null);
  }

  /* The indent has to be visible while it is being made, not discovered on
     release, so the row under the pointer is told what the drop would mean. */
  function onDragMove(event: DragMoveEvent) {
    const id = String(event.active.id);
    if (id.startsWith('section:')) return;
    setNesting(event.delta.x >= NEST_THRESHOLD_PX);
    setOutdenting(
      (id.startsWith(SUBTASK_DRAG_PREFIX) || id.startsWith('project-row:'))
      && event.delta.x <= -NEST_THRESHOLD_PX,
    );
  }

  async function onDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    dragClock.endedAt = Date.now();
    setDraggingId(null);
    setDragging(null);
    setDraggingSection(null);
    const { nesting, outdenting: pulledOut } = useStore.getState();
    setNesting(false);
    setOutdenting(false);
    setDraggingProject(null);
    setDraggingTag(null);

    /* Pulled out to the left, a subtask leaves its parent and stays where it
       is otherwise: same project, same section, now at the top level. The
       pointer may well be over nothing by then, so this comes first. */
    if (activeId.startsWith(SUBTASK_DRAG_PREFIX) && pulledOut) {
      const sub = snapshot.items[taskIdOf(activeId)];
      if (sub?.parent_id && !(event.over && decodeRowTarget(String(event.over.id)))) {
        await promoteTask(sub);
        return;
      }
    }
    /* The matching Todoist gesture for a nested project: pull it left one
       indentation level. It lands immediately after its former parent, which
       keeps the branch together instead of throwing the project to the end of
       an unrelated list. This also works when the pointer finishes in empty
       sidebar space. */
    if (activeId.startsWith('project-row:') && pulledOut) {
      const from = activeId.slice('project-row:'.length);
      const project = snapshot.projects[from];
      const formerParentId = project?.parent_id ?? null;
      if (project && formerParentId) {
        const nextParentId = snapshot.projects[formerParentId]?.parent_id ?? null;
        await nestProject(from, nextParentId);
        const current = useStore.getState().snapshot;
        const siblings = siblingOrder(current, from);
        if (siblings.includes(formerParentId)) {
          await reorderProjects(reorderRelative(
            siblings, from, formerParentId, 'after',
          ));
        }
      }
      return;
    }
    /* Pressed and held on a sidebar project and let go without moving. On a
       phone that is the gesture for "tell me about this one", and it is the
       same press that would have carried the row off had the finger gone on
       to move — held, lifted, put back: a question rather than a move. The
       three-dot button it replaces was a hover control with nothing to hover
       it, kept visible on touch only because there was no other way in. */
    if (activeId.startsWith('project-row:') && pressedAndHeld(event)) {
      const id = activeId.slice('project-row:'.length);
      document
        .querySelector<HTMLElement>(`[${projectRowAttr}="${id}"]`)
        ?.dispatchEvent(new CustomEvent(PRESS_HOLD_EVENT));
      return;
    }

    if (!event.over) return;

    /* A section is dragged whole, into a slot between two others. It is not a
       task and none of the task rules apply to it. */
    if (activeId.startsWith('section:')) {
      const overId = String(event.over.id);
      const from = activeId.slice('section:'.length);
      const sectionPosition = overId.match(/^section-slot:(.+):(before|after)$/);
      if (sectionPosition) {
        const siblings = Object.values(snapshot.sections)
          .filter((section) => section.project_id === snapshot.sections[from]?.project_id
            && !section.is_archived && !section.is_deleted)
          .sort(bySectionOrder)
          .map((section) => section.id);
        const next = reorderRelative(
          siblings, from, sectionPosition[1], sectionPosition[2] as 'before' | 'after',
        );
        await moveSection(from, next.indexOf(from));
        return;
      }
      if (!overId.startsWith('slot:')) return;
      const all = Object.values(snapshot.sections)
        .filter((section) => section.project_id === snapshot.sections[from]?.project_id
          && !section.is_archived && !section.is_deleted)
        .sort(bySectionOrder)
        .map((section) => section.id);
      const rawSlot = Number(overId.split(':')[1]);
      const next = reorderAtSlot(all, from, rawSlot);
      await moveSection(from, next.indexOf(from));
      return;
    }

    /* A subtask dragged in the task panel is reordered among its siblings, and
       goes nowhere else: the panel is one parent's list of children. */
    if (activeId.startsWith('subtask:')) {
      const overId = String(event.over.id);
      if (!overId.startsWith('subtask:')) return;
      const from = activeId.slice('subtask:'.length);
      const to = overId.slice('subtask:'.length);
      if (from === to) return;

      const parentId = snapshot.items[from]?.parent_id;
      if (!parentId || snapshot.items[to]?.parent_id !== parentId) return;

      const siblings = Object.values(snapshot.items)
        .filter((child) => child.parent_id === parentId && !child.is_deleted)
        .sort(byChildOrder)
        .map((child) => child.id);

      const at = siblings.indexOf(from);
      const onto = siblings.indexOf(to);
      if (at < 0 || onto < 0) return;
      const next = [...siblings];
      next.splice(onto, 0, ...next.splice(at, 1));
      await reorderSubtasks(next);
      return;
    }

    /* A tag goes two places: onto Favourites, which makes it one, and onto
       another tag, which puts it in that one's place. Both used to be out of
       reach — the first because a tag could not be picked up at all, the
       second because the Tags page held its own drag context and nothing
       dragged inside it could ever leave. */
    if (activeId.startsWith(TAG_DRAG_PREFIX)) {
      const name = activeId.slice(TAG_DRAG_PREFIX.length);
      const label = Object.values(snapshot.labels).find((l) => l.name === name);
      if (!label) return;
      const overId = String(event.over.id);

      if (decodeTarget(overId)?.kind === 'favourites') {
        if (!label.is_favorite) await setLabelFavourite(label.id, true);
        return;
      }

      if (overId === TAG_TOP_DROP_ID) {
        const names = [...tagOrderFor(name)];
        const at = names.indexOf(name);
        if (at <= 0) return;
        names.unshift(...names.splice(at, 1));
        const byName = new Map(
          Object.values(snapshot.labels).map((l) => [l.name, l.id] as const),
        );
        await reorderLabels(names.map((n) => byName.get(n)).filter((id): id is string => !!id));
        return;
      }

      if (!overId.startsWith(TAG_DROP_PREFIX)) return;
      const onto = overId.slice(TAG_DROP_PREFIX.length);
      if (onto === name) return;

      /* Spliced by the order on the page, then turned back into the ids the
         store reorders by. */
      const names = [...tagOrderFor(name)];
      const at = names.indexOf(name);
      const to = names.indexOf(onto);
      if (at < 0 || to < 0) return;
      names.splice(to, 0, ...names.splice(at, 1));
      const byName = new Map(
        Object.values(snapshot.labels).map((l) => [l.name, l.id] as const),
      );
      await reorderLabels(names.map((n) => byName.get(n)).filter((id): id is string => !!id));
      return;
    }

    /* A project dragged in the sidebar is reordered among its own siblings.
       It is not a destination for anything and it does not move between
       workspaces: the ids come from one list and go back as that list. */
    if (activeId.startsWith('project-row:')) {
      const overId = String(event.over.id);
      const from = activeId.slice('project-row:'.length);

      /* Dropped on the Favourites heading: a third thing a sidebar drop can
         mean, beside reordering and nesting. Taking one back out is the
         project's own menu, where it already was. */
      if (decodeTarget(overId)?.kind === 'favourites') {
        const project = snapshot.projects[from];
        if (project && !project.is_favorite) {
          await updateProjectFields(from, { is_favorite: true });
        }
        return;
      }

      const projectSlot = /^project-slot:(.+):(before|after)$/.exec(overId);
      const over = projectSlot
        ? projectSlot[1]
        : overId.startsWith('project-row:')
        ? overId.slice('project-row:'.length)
        : decodeTarget(overId)?.kind === 'project'
          ? (decodeTarget(overId) as { kind: 'project'; projectId: string }).projectId
          : null;
      if (!over || from === over) return;

      /* The seam above the first nested row visually belongs to its folder.
         Dropping a child there must move it to the start of that folder, not
         silently hit a non-sibling parent row. This also works after the
         children have already been reordered once. */
      if (snapshot.projects[from]?.parent_id === over) {
        const siblings = siblingOrder(snapshot, from);
        if (siblings.length > 1 && siblings[0] !== from) {
          await reorderProjects([from, ...siblings.filter((id) => id !== from)]);
        }
        return;
      }

      /* Dragged out to the right: the row it landed on becomes its parent.
         A folder needs no such gesture — putting projects inside it is the
         only thing a folder is for, so landing on one is enough. */
      if (nesting || snapshot.projects[over]?.is_folder) {
        await nestProject(from, over);
        return;
      }

      const siblings = siblingOrder(snapshot, from);
      if (!siblings.includes(from) || !siblings.includes(over)) return;
      const pointerY = event.activatorEvent instanceof MouseEvent || event.activatorEvent instanceof PointerEvent
        ? event.activatorEvent.clientY + event.delta.y : null;
      const rowRect = document.querySelector<HTMLElement>(`[${projectRowAttr}="${over}"]`)?.getBoundingClientRect();
      const overMiddle = rowRect ? rowRect.top + rowRect.height / 2 : event.over.rect.top + event.over.rect.height / 2;
      const fromIndex = siblings.indexOf(from);
      const overIndex = siblings.indexOf(over);
      const position = projectSlot
        ? projectSlot[2] as 'before' | 'after'
        : relativePositionFromCenters(fromIndex, overIndex, pointerY, overMiddle);
      const next = reorderRelative(
        siblings, from, over, position,
      );
      await reorderProjects(next);
      return;
    }

    const item = snapshot.items[taskIdOf(activeId)];
    /* One row, the two readings of it. Out to the right the task goes inside
       the row; straight onto it, the task takes its place. */
    const onRow = decodeRowTarget(String(event.over.id));
    if (item && onRow && onRow !== item.id) {
      const row = snapshot.items[onRow];
      if (!row) return;
      const list = (event.over.data.current as { list?: RowList } | undefined)?.list;
      if (nesting) { await nestTask(item, row.id); return; }
      if (!list) return;
      /* A task put into a place by hand is a view arranged by hand. Views open
         sorted by priority, and a drop used to be refused rather than obeyed
         on one; it is obeyed, and the sort gives way to it. The order written
         below is the order that was on the screen, so the page the sort leaves
         behind is the page you were looking at. */
      if (list.viewKey) setViewPrefs(list.viewKey, { sort: 'manual' });
      if (list.order === 'day') await orderInList(item, row, list);
      else await reorderTask(item, row, list);
      return;
    }

    const target = decodeTarget(String(event.over.id));
    if (!item || !target) return;

    /* A task carried out of a selection carries the selection: the drop is
       the same act the bulk bar does, on every picked task, with one toast
       and one undo. Only the dragged task used to go. */
    const store = useStore.getState();
    if (store.selection.length > 1 && store.selection.includes(item.id)) {
      const ids = store.selection;
      const name = groupDestination(target);
      if (target.kind === 'project' || target.kind === 'section') {
        store.clearSelection();
        await store.moveMany(ids, {
          project_id: target.projectId,
          section_id: target.kind === 'section' ? target.sectionId ?? null : null,
        }, name);
        return;
      }
      if (name) {
        store.clearSelection();
        await store.sendManyTo(ids, target, name);
        return;
      }
    }

    await dropOnto(item, target);
  }

  /**
   * A task dropped on a place rather than onto a row: the mutation the drop
   * table defines for that place, and an undo. Also where ⌘↑ / ⌘↓ land a task
   * in an empty section (TASK_DROP_EVENT).
   */
  async function dropOnto(item: Item, target: DropTarget) {
    const mutation = dropMutation(item, target);
    if (!mutation) return;

    // Captured before the change so the undo can put every field back.
    const before = {
      parent_id: item.parent_id,
      due: item.due,
      labels: item.labels,
      project_id: item.project_id,
      section_id: item.section_id,
    };

    const patch = (fields: Record<string, unknown>) => (snap: typeof snapshot) => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } as Item },
    });

    if (mutation.update) {
      await apply([updateItem(item.id, mutation.update)], patch(mutation.update));
    } else if (mutation.move) {
      // A move to a project or a section lands at its top level.
      await apply([moveItem(item.id, moveArgs(mutation.move))], patch({ ...mutation.move, parent_id: null }));
    }

    /* A move is undone by a move. `item_update` does not take a project or a
       section, so undoing a drop between columns used to put the card back on
       screen and leave it where it was dropped on the server. */
    const undo = !mutation.move
      ? updateItem(item.id, { due: before.due, labels: before.labels })
      : before.parent_id
        ? moveItem(item.id, { parent_id: before.parent_id })
        : moveItem(item.id, moveArgs({ project_id: before.project_id, section_id: before.section_id }));
    toast(whatHappened(target) ?? item.content, () => {
      void apply([undo], patch(before));
    });
  }

  /**
   * Dropped into a list that several projects feed: a week, a tag, everything
   * put off.
   *
   * Their order cannot be `child_order`, which Todoist counts inside a single
   * project — five projects on one page would each be counting from one. It is
   * `day_order`, the number Todoist keeps for exactly these lists, so the order
   * is written to Todoist like everything else here rather than into a corner
   * of this app that only this browser can see.
   *
   * The list is also a place. A task dragged into it from another group means
   * both things at once — this day, and here in it — so what the group would
   * have done to a task dropped on it plainly is done first.
   */
  async function orderInList(item: Item, row: Item, list: RowList, landAfter = false) {
    const ids = [...list.ids];
    const onto = ids.indexOf(row.id);
    if (onto < 0) return;
    const at = ids.indexOf(item.id);
    if (at >= 0) ids.splice(onto, 0, ...ids.splice(at, 1));
    // A task from another list goes in before the row, or after it when asked.
    else ids.splice(onto + (landAfter ? 1 : 0), 0, item.id);

    const before = Object.fromEntries(
      ids.filter((id) => snapshot.items[id]).map((id) => [id, snapshot.items[id].day_order]),
    );
    const after = Object.fromEntries(ids.map((id, index) => [id, index + 1]));

    const mutation = list.target ? dropMutation(item, list.target) : null;
    const was = {
      due: item.due, labels: item.labels,
      project_id: item.project_id, section_id: item.section_id,
    };

    const place = (
      orders: Record<string, number>,
      fields: Record<string, unknown>,
    ) => (snap: typeof snapshot) => {
      const items = { ...snap.items };
      for (const [id, day_order] of Object.entries(orders)) {
        if (items[id]) items[id] = { ...items[id], day_order };
      }
      if (items[item.id]) items[item.id] = { ...items[item.id], ...fields } as Item;
      return { ...snap, items };
    };

    await apply(
      [
        ...(mutation?.update ? [updateItem(item.id, mutation.update)] : []),
        ...(mutation?.move ? [moveItem(item.id, moveArgs(mutation.move))] : []),
        updateDayOrders(after),
      ],
      place(after, mutation?.update ?? (mutation?.move ? { ...mutation.move, parent_id: null } : {})),
    );

    /* Only a task that changed lists is worth a toast: an order put back is
       put back by looking at it. */
    if (!mutation) return;
    const undo = mutation.move
      ? moveItem(item.id, moveArgs({ project_id: was.project_id, section_id: was.section_id }))
      : updateItem(item.id, { due: was.due, labels: was.labels });
    toast(
      (list.target ? whatHappened(list.target) : null) ?? item.content,
      () => { void apply([undo, updateDayOrders(before)], place(before, was)); },
    );
  }

  /**
   * Dropped straight onto another row: the task takes that row's place.
   *
   * The same splice the sidebar does with projects, so dragging down lands
   * below the row you aimed at and dragging up lands above it. `child_order`
   * is counted inside one container, so a task arriving from another section
   * joins that container first, in the same batch — otherwise Todoist would
   * renumber it among tasks it does not live with.
   */
  async function reorderTask(item: Item, row: Item, list: RowList, landAfter = false) {
    const container = {
      project_id: row.project_id,
      section_id: row.section_id,
      parent_id: row.parent_id,
    };
    const joining = item.project_id !== container.project_id
      || (item.section_id ?? null) !== (container.section_id ?? null)
      || (item.parent_id ?? null) !== (container.parent_id ?? null);

    const siblings = siblingTasks(snapshot.items, joining ? { ...item, ...container } : item);

    /* `child_order` is the order in the database and the list is in the order
       on the screen, which are the same thing only under a manual sort. The
       drop is about the one you are looking at, so the numbering is written
       from the screen: the siblings the page is showing are laid back into
       their own slots in screen order, and the ones a filter is hiding keep
       the places they had between them. */
    const shown = list.ids.filter((id) => siblings.includes(id));
    const arranged = [...siblings];
    const slots = siblings
      .map((id, at) => (shown.includes(id) ? at : -1))
      .filter((at) => at >= 0);
    slots.forEach((at, index) => { arranged[at] = shown[index]; });

    const onto = arranged.indexOf(row.id);
    if (onto < 0) return;
    const next = [...arranged];
    const at = next.indexOf(item.id);
    if (at >= 0) next.splice(onto, 0, ...next.splice(at, 1));
    else next.splice(onto + (landAfter ? 1 : 0), 0, item.id);

    const move = container.parent_id
      ? moveItem(item.id, { parent_id: container.parent_id })
      : moveItem(item.id, moveArgs({
        project_id: container.project_id, section_id: container.section_id,
      }));
    const home = {
      project_id: item.project_id, section_id: item.section_id, parent_id: item.parent_id,
    };
    const back = home.parent_id
      ? moveItem(item.id, { parent_id: home.parent_id })
      : moveItem(item.id, moveArgs({ project_id: home.project_id, section_id: home.section_id }));

    /* Where every sibling carries an `order_key`, the task takes a key between
       its two new neighbours: one write to the task that moved, and none to
       the others. Todoist may nudge the key if another client took it, and
       the corrected one comes back with its answer. */
    const landed = next.indexOf(item.id);
    const neighbours = next.filter((id) => id !== item.id);
    let orderKey: string | null = null;
    if (next.every((id) => id === item.id || snapshot.items[id]?.order_key)) {
      try {
        orderKey = keyBetween(
          snapshot.items[neighbours[landed - 1]]?.order_key ?? null,
          snapshot.items[neighbours[landed]]?.order_key ?? null,
        );
      } catch {
        // The screen is not in key order (a sort, a filter): renumber below.
        orderKey = null;
      }
    }

    if (orderKey) {
      const key = orderKey;
      const was = item.order_key ?? null;
      const set = (fields: Partial<Item>) => (snap: typeof snapshot) => ({
        ...snap,
        items: { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } },
      });
      await apply(
        joining ? [move, updateItem(item.id, { order_key: key })] : [updateItem(item.id, { order_key: key })],
        set({ ...(joining ? container : {}), order_key: key }),
      );
      if (!joining) return;
      toast(whereItLanded(container), () => {
        void apply(
          was ? [back, updateItem(item.id, { order_key: was })] : [back],
          set({ ...home, order_key: was }),
        );
      });
      return;
    }

    /* Every task whose number this changes, on both sides of the move, so the
       undo can put the numbering back exactly as it was. */
    const touched = new Set([...siblingTasks(snapshot.items, item), ...siblings, item.id]);
    const before = [...touched]
      .filter((id) => snapshot.items[id])
      .map((id) => ({
        id, child_order: snapshot.items[id].child_order, order_key: snapshot.items[id].order_key ?? null,
      }));
    /* A fresh run of keys with the numbers, so the list sorts one way on
       screen until Todoist's own keys come back with its answer. */
    const keys = keysInOrder(next.length);
    const after = next.map((id, index) => ({ id, child_order: index + 1, order_key: keys[index] }));

    const place = (
      fields: Partial<Item>,
      orders: Array<{ id: string; child_order: number; order_key: string | null }>,
    ) => (snap: typeof snapshot) => {
      const items = { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } };
      for (const { id, child_order, order_key } of orders) {
        if (items[id]) items[id] = { ...items[id], child_order, order_key };
      }
      return { ...snap, items };
    };
    const numbers = (orders: Array<{ id: string; child_order: number }>) =>
      reorderItems(orders.map(({ id, child_order }) => ({ id, child_order })));

    await apply(
      joining ? [move, numbers(after)] : [numbers(after)],
      place(joining ? container : {}, after),
    );

    /* A task put back in line is undone by looking at it, so only a task that
       also left its section is worth a toast. */
    if (!joining) return;
    toast(whereItLanded(container), () => {
      void apply([back, numbers(before)], place(home, before));
    });
  }

  /* Dropped indented onto another row: the task becomes its subtask, and
     follows it into its project and section, taking its own subtasks along. */
  async function nestTask(item: Item, parentId: string) {
    const parent = snapshot.items[parentId];
    if (!parent || !canNest(snapshot.items, item.id, parent.id)) return;

    const below = new Set<string>();
    for (let grew = true; grew;) {
      grew = false;
      for (const other of Object.values(snapshot.items)) {
        if (other.parent_id && (other.parent_id === item.id || below.has(other.parent_id)) && !below.has(other.id)) {
          below.add(other.id);
          grew = true;
        }
      }
    }

    const place = (fields: Pick<Item, 'parent_id' | 'project_id' | 'section_id'>) =>
      (snap: typeof snapshot) => {
        const items = { ...snap.items, [item.id]: { ...snap.items[item.id], ...fields } };
        for (const id of below) {
          items[id] = { ...items[id], project_id: fields.project_id, section_id: fields.section_id };
        }
        return { ...snap, items };
      };

    const before = { parent_id: item.parent_id, project_id: item.project_id, section_id: item.section_id };
    await apply(
      [moveItem(item.id, { parent_id: parent.id })],
      place({ parent_id: parent.id, project_id: parent.project_id, section_id: parent.section_id }),
    );

    // Moving to a project or a section puts a task back at its top level.
    const undo = before.parent_id
      ? moveItem(item.id, { parent_id: before.parent_id })
      : moveItem(item.id, moveArgs({ project_id: before.project_id, section_id: before.section_id }));
    toast(t('drop.nested', { name: parent.content }), () => {
      void apply([undo], place(before));
    });
  }

  async function promoteTask(item: Item) {
    const parentId = item.parent_id;
    if (!parentId) return;
    const patch = (parent_id: string | null) => (snap: typeof snapshot) => ({
      ...snap,
      items: { ...snap.items, [item.id]: { ...snap.items[item.id], parent_id } },
    });
    await apply(
      [moveItem(item.id, moveArgs({ project_id: item.project_id, section_id: item.section_id }))],
      patch(null),
    );
    toast(t('drop.promoted'), () => {
      void apply([moveItem(item.id, { parent_id: parentId })], patch(parentId));
    });
  }

  const dragging = draggingId?.startsWith('subtask:')
    ? snapshot.items[draggingId.slice('subtask:'.length)]
    : draggingId && !draggingId.startsWith('section:')
      ? snapshot.items[taskIdOf(draggingId)]
      : null;
  const draggingSection = draggingId?.startsWith('section:')
    ? snapshot.sections[draggingId.slice('section:'.length)]
    : null;
  const draggingProjectRow = draggingId?.startsWith('project-row:')
    ? snapshot.projects[draggingId.slice('project-row:'.length)]
    : null;
  const draggingTagName = draggingId?.startsWith(TAG_DRAG_PREFIX)
    ? draggingId.slice(TAG_DRAG_PREFIX.length)
    : null;

  /* The keys' way to the same place a drop reaches (see TASK_PLACE_EVENT).
     Read through a ref: the functions above close over this render's
     snapshot, and the listener is registered once. */
  const placeFromKeys = useRef<(request: TaskPlaceRequest) => void>(() => {});
  placeFromKeys.current = ({ itemId, ontoId, list, subtask, after = false }) => {
    const item = snapshot.items[itemId];
    const row = snapshot.items[ontoId];
    if (!item || !row) return;
    if (subtask) { void reorderTask(item, row, list); return; }
    if (list.viewKey) setViewPrefs(list.viewKey, { sort: 'manual' });
    if (list.order === 'day') void orderInList(item, row, list, after);
    else void reorderTask(item, row, list, after);
  };
  const dropFromKeys = useRef<(request: TaskDropRequest) => void>(() => {});
  dropFromKeys.current = ({ itemId, target }) => {
    const item = snapshot.items[itemId];
    if (item) void dropOnto(item, target);
  };
  useEffect(() => {
    const onPlace = (event: Event) => {
      placeFromKeys.current((event as CustomEvent<TaskPlaceRequest>).detail);
    };
    const onDrop = (event: Event) => {
      dropFromKeys.current((event as CustomEvent<TaskDropRequest>).detail);
    };
    window.addEventListener(TASK_PLACE_EVENT, onPlace);
    window.addEventListener(TASK_DROP_EVENT, onDrop);
    return () => {
      window.removeEventListener(TASK_PLACE_EVENT, onPlace);
      window.removeEventListener(TASK_DROP_EVENT, onDrop);
    };
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionsForKind}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      {children}
      {/* Without a modifier the preview stays at the row's original position
          instead of following the pointer. */}
      <DragOverlay dropAnimation={null} modifiers={[anchorLeftOfCursor]}>
        {dragging && (
          <div className={`dragoverlay${outdenting ? ' outdent' : ''}`}>{dragging.content}</div>
        )}
        {draggingSection && (
          <div className="dragoverlay section">{draggingSection.name || '—'}</div>
        )}
        {/* A project and a tag are carried the same way a task is. Without a
            preview the pointer held nothing and the only sign anything was
            happening was the row going faint behind it. */}
        {draggingProjectRow && (
          <div className={`dragoverlay project${outdenting ? ' outdent' : ''}`}>
            <span className="hash" style={markerStyle(draggingProjectRow.color)}>#</span>
            {draggingProjectRow.name}
          </div>
        )}
        {draggingTagName && (
          <div className="dragoverlay tag">
            <Icon name="tag" size="sm" />
            {draggingTagName}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
