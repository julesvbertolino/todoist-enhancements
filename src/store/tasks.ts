/** Tasks: creating, editing, ticking, recurring, deleting and restoring. */
import { command, addItem, completeItem, deleteItem, newUuid, reorderItems, uncompleteItem, updateItem } from '@/api/commands';
import * as idb from '@/db/idb';
import { isUncompletable, toTodoistPriority, type Item, type Snapshot } from '@/domain/types';
import { withEstimate } from '@/domain/estimates';
import { toApiDate } from '@/domain/dates';
import { translate } from '@/i18n';
import { byChildOrder, keyBetween, keysInOrder } from '@/domain/orderKey';
import { UNDO_TOAST_MS, advanceDemoRecurrence, hidePending, patchItem, pendingDeletes, schedulePersist, settleFromServer } from './helpers';
import type { Slice, TasksSlice } from './types';

/**
 * A due the rest of the app can read.
 *
 * A recurrence is sent to Todoist as a rule with no date on it, on purpose.
 * The row the app draws in the meantime still has to have one, so today fills
 * in until the sync response says where the rule actually landed. Nothing is
 * sent anywhere from here: this value never leaves the local snapshot.
 */
export const provisionalDue = (due: Item['due'] | undefined): Item['due'] => {
  if (!due) return null;
  if (due.date) return due;
  return { ...due, date: toApiDate(new Date()), timezone: due.timezone ?? null };
};

/**
 * The position a new task takes among the ones it is joining.
 *
 * Todoist appends, so the optimistic row has to append too — a row that draws
 * itself at the top and is corrected a moment later reads as a bug even when
 * the result is right.
 */
export function nextChildOrder(
  snapshot: Snapshot,
  parentId: string | null,
  projectId: string,
  sectionId: string | null,
): number {
  const siblings = Object.values(snapshot.items).filter((item) => {
    if (item.is_deleted) return false;
    if (parentId) return item.parent_id === parentId;
    return !item.parent_id && item.project_id === projectId
      && (item.section_id ?? null) === sectionId;
  });
  return siblings.reduce((top, item) => Math.max(top, item.child_order), 0) + 1;
}

/**
 * The key a new task will get from Todoist, at the end of its siblings.
 *
 * Todoist appends a new task by key when its siblings have keys, and a list
 * that sorts by key would draw an optimistic row without one wherever its
 * number happened to fall. Null where the siblings are not migrated.
 */
export function nextOrderKey(
  snapshot: Snapshot,
  parentId: string | null,
  projectId: string,
  sectionId: string | null,
): string | null {
  const siblings = Object.values(snapshot.items).filter((item) => {
    if (item.is_deleted) return false;
    if (parentId) return item.parent_id === parentId;
    return !item.parent_id && item.project_id === projectId
      && (item.section_id ?? null) === sectionId;
  });
  if (siblings.length === 0 || !siblings.every((item) => item.order_key)) return null;
  const last = siblings.sort(byChildOrder)[siblings.length - 1].order_key ?? null;
  try {
    return keyBetween(last, null);
  } catch {
    return null;
  }
}

export const createTasksSlice: Slice<TasksSlice> = (set, get) => ({
  async updateTask(id, args) {
    await get().apply([updateItem(id, args)], (snapshot) => patchItem(snapshot, id, args));
  },
  /**
   * Gives a task a repeat rule.
   *
   * Two different objects, deliberately. What goes to Todoist is the rule and
   * nothing else, because Todoist resolves where the rule lands and a date
   * sent from here would pin the first occurrence to this device's guess at
   * it. What goes into the local snapshot has to be a complete due all the
   * same — every list in the app reads `due.date`, and one without it takes
   * the page down — so it keeps the date the task is already sitting on until
   * the sync response arrives with the one the rule really resolves to.
   */
  async setRecurrence(id, rule) {
    const item = get().snapshot.items[id];
    if (!item) return;

    const due = { string: rule.string, lang: rule.lang, is_recurring: true };
    const local = {
      due: {
        ...due,
        date: item.due?.date ?? toApiDate(new Date()),
        timezone: item.due?.timezone ?? null,
      },
    };

    await get().apply([updateItem(id, { due })], (snapshot) => patchItem(snapshot, id, local));
    /* Only Todoist knows the date the rule resolves to. Its answer to the
       update brings it, and the task comes back with a new `updated_at`; one
       that did not come back is fetched. */
    const stamp = item.updated_at;
    await settleFromServer(get, id, (current) => current.updated_at === stamp);
  },
  async setEstimates(entries) {
    const snapshot = get().snapshot;
    const changes = entries
      .map(({ id, minutes }) => {
        const item = snapshot.items[id];
        return item ? { id, labels: withEstimate(item.labels, minutes) } : null;
      })
      .filter((change): change is { id: string; labels: string[] } => change !== null);

    if (changes.length === 0) return;

    await get().apply(
      changes.map(({ id, labels }) => updateItem(id, { labels })),
      (current) =>
        changes.reduce((acc, { id, labels }) => patchItem(acc, id, { labels }), current),
    );
  },
  async toggleTask(id) {
    const item = get().snapshot.items[id];
    if (!item || isUncompletable(item)) return;

    /* `item_close` is Todoist's official recurrence-aware completion command.
       Todoist computes the next date from the rule; sending the current due
       back through item_update_date_complete made the old occurrence bounce
       between dates and occasionally remain checked. */
    if (!item.checked && item.due?.is_recurring) {
      const demo = get().demo;
      await get().apply([command('item_close', { id })], (snapshot) =>
        demo ? advanceDemoRecurrence(snapshot, id) : patchItem(snapshot, id, { checked: true }));
      /* Todoist's answer to the close is the task on its next date, unticked.
         A task still ticked here is one that answer did not carry. */
      await settleFromServer(get, id, (current) => current.checked);
      return;
    }
    const checked = !item.checked;
    const cmd = checked ? completeItem(id) : uncompleteItem(id);
    const done = get().apply([cmd], (snapshot) => patchItem(snapshot, id, { checked }));

    /* No toast: ticking something off is the most common act in the app and a
       message after every one would be a message after everything. It is still
       the thing people most often wish they could take back, so the step is
       recorded and Cmd+Z reaches it — recorded at once, not after Todoist has
       answered, or a quick Cmd+Z undid whatever came before. The way back
       waits for the way there, so the two can never cross on the network. */
    get().pushUndo(item.content, async () => {
      await done;
      const back = checked ? uncompleteItem(id) : completeItem(id);
      await get().apply([back], (snapshot) => patchItem(snapshot, id, { checked: !checked }));
    });
    await done;
  },
  async completeTasks(ids) {
    const snapshot = get().snapshot;
    const items = [...new Set(ids)]
      .map((id) => snapshot.items[id])
      .filter((item): item is Item => !!item && !item.checked && !isUncompletable(item));
    if (items.length === 0) return;
    const recurring = items.filter((item) => item.due?.is_recurring);
    const plain = items.filter((item) => !item.due?.is_recurring);
    const demo = get().demo;

    const done = get().apply(
      [
        ...recurring.map((item) => command('item_close', { id: item.id })),
        ...plain.map((item) => completeItem(item.id)),
      ],
      (current) => items.reduce((acc, item) => (item.due?.is_recurring && demo
        ? advanceDemoRecurrence(acc, item.id)
        : patchItem(acc, item.id, { checked: true })), current),
    );

    /* One step back for the whole selection. A recurring task has already
       rolled on to its next date and has nothing to reopen, so the undo puts
       back the one-off tasks, which is what the toast counts. */
    const label = translate(get().prefs.locale, 'task.completedMany', { count: items.length });
    if (plain.length > 0) {
      get().toast(label, async () => {
        await done;
        await get().apply(
          plain.map((item) => uncompleteItem(item.id)),
          (current) => plain.reduce((acc, item) => patchItem(acc, item.id, { checked: false }), current),
        );
      });
    } else {
      get().toast(label);
    }
    await done;
    const stillTicked = recurring.find((item) => get().snapshot.items[item.id]?.checked);
    if (stillTicked) await settleFromServer(get, stillTicked.id, (current) => current.checked);
  },
  async removeTask(id) {
    await get().removeTasks([id]);
  },
  /**
   * Deletes tasks, and offers them back.
   *
   * The rows go at once; the deletion itself waits for the toast to go (see
   * `pendingDeletes`). Undo inside that window cancels it and puts back the
   * same tasks. After it — Cmd+Z reaches further back than a toast lasts —
   * the deletion has gone out and Todoist has no undelete, so the branch is
   * rebuilt instead, as close to the original as the API allows, and the toast
   * says it is a copy.
   *
   * Subtasks go with their parent when Todoist deletes it, so they are
   * captured too: a branch comes back whole or not at all.
   */
  async removeTasks(ids) {
    const snapshot = get().snapshot;
    const wanted = ids.filter((id) => snapshot.items[id]);
    if (wanted.length === 0) return;

    // Every descendant, so the whole branch comes back rather than its top.
    const doomed: Item[] = [];
    const walk = (parentId: string) => {
      for (const item of Object.values(snapshot.items)) {
        if (item.parent_id === parentId && !item.is_deleted) {
          doomed.push(item);
          walk(item.id);
        }
      }
    };
    for (const id of wanted) {
      doomed.push(snapshot.items[id]);
      walk(id);
    }
    // Their comments too, for the copy a late undo has to make.
    const doomedIds = new Set(doomed.map((item) => item.id));
    const notes = Object.values(snapshot.notes)
      .filter((note) => !note.is_deleted && note.item_id && doomedIds.has(note.item_id));

    const commands = wanted.map(deleteItem);
    const key = newUuid();
    const commit = () => {
      const pending = pendingDeletes.get(key);
      if (!pending) return;
      pendingDeletes.delete(key);
      /* The rows are already gone; this only sends the deletion (and, in the
         demo, only forgets it). */
      void get().apply(pending.commands, (current) => current);
    };

    pendingDeletes.set(key, {
      timer: setTimeout(commit, UNDO_TOAST_MS),
      commands,
      items: doomed,
      queued: false,
    });
    set({ snapshot: hidePending(get().snapshot) });
    schedulePersist(get().snapshot);

    const label = wanted.length === 1
      ? translate(get().prefs.locale, 'task.deletedOne', { name: snapshot.items[wanted[0]].content })
      : translate(get().prefs.locale, 'task.deletedMany', { count: wanted.length });

    get().toast(label, () => {
      const pending = pendingDeletes.get(key);
      if (pending) {
        // Never sent: the same tasks come straight back.
        clearTimeout(pending.timer);
        pendingDeletes.delete(key);
        if (pending.queued) void idb.dequeue(pending.commands.map((c) => c.uuid));
        const items = { ...get().snapshot.items };
        for (const item of pending.items) items[item.id] = item;
        set({ snapshot: { ...get().snapshot, items } });
        schedulePersist(get().snapshot);
        return;
      }
      // Already sent: Todoist has no undelete, so a copy is the best there is.
      void get().restoreTasks(doomed, notes).then(() => {
        get().toast(translate(get().prefs.locale, 'task.restoredAsCopy', {
          count: wanted.length,
        }));
      });
    });
  },
  async restoreTasks(items, notes = []) {
    if (items.length === 0) return;

    /* Parents first, so a child's new parent id is known — or at least sent as
       a temp id in the same call, which Todoist resolves inside one request. */
    const tempIds = new Map(items.map((item) => [item.id, newUuid()]));
    const ordered = [...items].sort((a, b) => {
      if (a.parent_id === b.id) return 1;
      if (b.parent_id === a.id) return -1;
      return 0;
    });

    const commands = ordered.map((item) => addItem({
      content: item.content,
      description: item.description || undefined,
      project_id: item.project_id,
      section_id: item.section_id ?? undefined,
      parent_id: item.parent_id ? (tempIds.get(item.parent_id) ?? item.parent_id) : undefined,
      priority: item.priority,
      labels: item.labels,
      due: item.due ?? undefined,
      deadline: item.deadline ?? undefined,
      duration: item.duration ?? undefined,
      responsible_uid: item.responsible_uid ?? undefined,
      child_order: item.child_order,
    }, tempIds.get(item.id)!));

    /* The comments come back on the copies, oldest first, attachments
       included: a file already uploaded to Todoist is linked, not re-sent. */
    const noteCommands = [...notes]
      .sort((a, b) => a.posted_at.localeCompare(b.posted_at))
      .filter((note) => note.item_id && tempIds.has(note.item_id))
      .map((note) => command('note_add', {
        item_id: tempIds.get(note.item_id!)!,
        content: note.content,
        ...(note.file_attachment ? { file_attachment: note.file_attachment } : {}),
      }));
    commands.push(...noteCommands);

    await get().apply(commands, (current) => {
      const restored = { ...current.items };
      for (const item of ordered) {
        const tempId = tempIds.get(item.id)!;
        restored[tempId] = {
          ...item,
          id: tempId,
          parent_id: item.parent_id ? (tempIds.get(item.parent_id) ?? item.parent_id) : null,
        };
      }
      return { ...current, items: restored };
    });
  },
  async createTask(args) {
    const tempId = newUuid();
    // The task appears at once under a temporary id; the sync response that
    // follows carries the real one and replaces it.
    const optimisticItem: Item = {
      id: tempId,
      user_id: get().snapshot.user?.id ?? '',
      project_id: String(args.project_id ?? get().snapshot.user?.inbox_project_id ?? ''),
      section_id: (args.section_id as string) ?? null,
      parent_id: (args.parent_id as string) ?? null,
      content: String(args.content ?? ''),
      description: String(args.description ?? ''),
      priority: (args.priority as 1 | 2 | 3 | 4) ?? 1,
      /* A task created from a repeat rule is sent without a date, so that
         Todoist resolves it — but the row drawn a moment later still has to
         have one to read. Today stands in until the real one comes back. */
      due: provisionalDue(args.due as Item['due']),
      deadline: (args.deadline as Item['deadline']) ?? null,
      duration: null,
      labels: (args.labels as string[]) ?? [],
      /* Last among its siblings, which is where a task just added belongs and
         where the server is about to put it. Left at 0 the row appeared at the
         top of its parent for the half second before the sync answered, and
         then jumped. */
      child_order: nextChildOrder(
        get().snapshot,
        (args.parent_id as string) ?? null,
        String(args.project_id ?? get().snapshot.user?.inbox_project_id ?? ''),
        (args.section_id as string) ?? null,
      ),
      order_key: nextOrderKey(
        get().snapshot,
        (args.parent_id as string) ?? null,
        String(args.project_id ?? get().snapshot.user?.inbox_project_id ?? ''),
        (args.section_id as string) ?? null,
      ),
      day_order: -1,
      collapsed: false,
      checked: false,
      is_deleted: false,
      added_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
      responsible_uid: (args.responsible_uid as string) ?? null,
    };

    /* Subtasks go out in the same batch, pointing at the parent's temp id.
       Todoist resolves a temp id used as an argument inside one call, so the
       whole tree is created in a single round trip and can never half-exist. */
    const subtasks = (args.subtasks as string[] | undefined) ?? [];
    const { subtasks: _ignored, ...parentArgs } = args;

    const children = subtasks.map((content) => ({
      tempId: newUuid(),
      args: {
        content,
        project_id: parentArgs.project_id,
        parent_id: tempId,
      },
    }));

    const optimisticChildren: Record<string, Item> = {};
    for (const child of children) {
      optimisticChildren[child.tempId] = {
        ...optimisticItem,
        id: child.tempId,
        parent_id: tempId,
        content: String(child.args.content),
        description: '',
        priority: 1,
        due: null,
        deadline: null,
        labels: [],
      };
    }

    await get().apply(
      [addItem(parentArgs, tempId), ...children.map((c) => addItem(c.args, c.tempId))],
      (snapshot) => ({
        ...snapshot,
        items: { ...snapshot.items, [tempId]: optimisticItem, ...optimisticChildren },
      }),
    );
  },
  async setTaskLabels(id, labels) {
    await get().updateTask(id, { labels });
  },
  async setTaskPriority(id, priority) {
    await get().updateTask(id, { priority: toTodoistPriority(priority) });
  },
  /**
   * Advances a recurring task to its next occurrence.
   *
   * Todoist has no skip command: closing a recurring task is what rolls the
   * series forward, which is exactly what the menu offers here.
   */
  async skipOccurrence(id) {
    const item = get().snapshot.items[id];
    if (!item?.due?.is_recurring) return;
    const demo = get().demo;
    await get().apply([command('item_close', { id })], (snapshot) =>
      demo ? advanceDemoRecurrence(snapshot, id) : patchItem(snapshot, id, { checked: true }));
    await settleFromServer(get, id, (current) => current.checked);
  },
  async skipOccurrences(ids) {
    const recurring = [...new Set(ids)].filter(
      (id) => get().snapshot.items[id]?.due?.is_recurring,
    );
    if (recurring.length === 0) return 0;
    const demo = get().demo;
    await get().apply(
      recurring.map((id) => command('item_close', { id })),
      (snapshot) => recurring.reduce(
        (current, id) => demo
          ? advanceDemoRecurrence(current, id)
          : patchItem(current, id, { checked: true }),
        snapshot,
      ),
    );
    /* One incremental sync at most, whatever the size of the selection: the
       first task still ticked is enough to say the answer was incomplete. */
    const stillTicked = recurring.find((id) => get().snapshot.items[id]?.checked);
    if (stillTicked) await settleFromServer(get, stillTicked, (current) => current.checked);
    return recurring.length;
  },
  async reorderSubtasks(ids) {
    const items = get().snapshot.items;
    const listed = ids.filter((id) => items[id]);
    const current = Object.values(items)
      .filter((item) => listed.includes(item.id))
      .sort(byChildOrder)
      .map((item) => item.id);
    if (listed.length === 0 || listed.join() === current.join()) return;

    const orders = listed.map((id, index) => ({ id, child_order: index + 1 }));
    const keys = keysInOrder(listed.length);
    await get().apply([reorderItems(orders)], (snapshot) => {
      const next = { ...snapshot.items };
      listed.forEach((id, index) => {
        if (next[id]) next[id] = { ...next[id], child_order: index + 1, order_key: keys[index] };
      });
      return { ...snapshot, items: next };
    });
  },
});
