import { useMemo } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SubtasksProvider } from '@/components/TaskRow';
import { DisplayMenu } from '@/components/DisplayMenu';
import { TaskGroup } from '@/components/TaskGroup';
import { ModeSurface } from '@/components/ModeSurface';
import { Icon } from '@/components/Icon';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { useConfirm } from '@/components/overlays/Confirm';
import { viewPrefs } from '@/store/prefs';
import { applyFilters, rootItems, sortItems } from '@/store/selectors';
import { anytimeItems, bucketOf, groupWeek, weekItems } from '@/domain/views';
import { summariseLoad, weeklyCapacity } from '@/domain/load';
import { toApiDate } from '@/domain/dates';
import { dueForDate } from '@/domain/recurrence';
import { weekLabel } from '@/domain/types';
import { placementFor, type TaskPlacement } from '@/domain/dnd';
import type { GroupKey } from '@/domain/types';

/**
 * How much of the week this page is showing.
 *
 * 'all' is My week as the product intends it. The other two exist because the
 * sidebar can be set to separate Today from the rest, and a page that is not
 * showing the whole week must not measure itself against the whole week's
 * capacity or offer to drop work into a group it does not draw.
 */
export type WeekScope = 'all' | 'today' | 'anytime';

interface WeekViewProps {
  onOpen: (id: string) => void;
  onInsights: () => void;
  onUnestimated: () => void;
  onAddTaskTo: (placement: TaskPlacement) => void;
  scope?: WeekScope;
}

/**
 * My week — the home of the product.
 *
 * Today comes first, in the fixed order the spec sets: behind schedule, quick,
 * untimed, then timed. Anytime this week follows, holding the flexible work
 * that carries the `week` label but no day.
 */
/**
 * What a column's own heading fixes, and nothing else.
 *
 * Grouped by priority, My week knows the priority of every task in a column
 * and knows nothing at all about when it is meant to happen — so the line at
 * the bottom of that column fills the priority in and leaves the date and the
 * week label alone. The same for a project column and a tag column. A column
 * that fixes nothing the composer can be opened with gets no line.
 */
function addToGroupFor(group: GroupKey, key: string): TaskPlacement | undefined {
  if (group === 'project') return { projectId: key };
  if (group === 'label' && key !== 'none') return { labels: [key] };
  if (group === 'priority') {
    const at = Number(key.replace('p', ''));
    if (at >= 1 && at <= 4) return { priority: at as 1 | 2 | 3 | 4 };
  }
  return undefined;
}

function WeekBody({
  onOpen, onInsights, onUnestimated, onAddTaskTo, scope = 'all',
}: WeekViewProps) {
  const { t } = useT();
  const { snapshot, items, childrenOf } = useData();
  const prefs = useStore((s) => s.prefs);
  const updateTask = useStore((s) => s.updateTask);
  const toast = useStore((s) => s.toast);
  const confirm = useConfirm();
  /* Two pages, two sets of display preferences: a filter set on Today has no
     business following you to the rest of the week. */
  const viewKey = scope === 'today' ? 'today' : 'week';
  const current = viewPrefs(prefs, viewKey);

  const scoped = useMemo(() => {
    const roots = rootItems(items);
    const now = new Date();
    const inScope =
      scope === 'today'
        ? roots.filter((i) => {
            const bucket = bucketOf(i, now);
            return bucket === 'overdue' || bucket === 'today';
          })
        : scope === 'anytime'
          ? anytimeItems(roots, now)
          : weekItems(roots, now);
    return applyFilters(inScope, current.filters, snapshot, childrenOf);
  }, [items, current.filters, snapshot, childrenOf, scope]);

  const groups = useMemo(
    () => groupWeek(scoped, new Date(), prefs.showQuickGroup),
    [scoped, prefs.showQuickGroup],
  );

  /* Today is measured against today's hours, not the week's. A day page
     showing "12 % of capacity" would be describing a week it does not draw. */
  const capacity = scope === 'today'
    ? prefs.dailyCapacity[new Date().getDay()]
    : weeklyCapacity(prefs.dailyCapacity, prefs.weeklyCapacityOverride);
  const load = useMemo(
    () => summariseLoad(scoped, childrenOf, capacity),
    [scoped, childrenOf, capacity],
  );

  async function rescheduleOverdue() {
    const affected = groups.overdue;
    if (affected.length === 0) return;
    // Moving several tasks at once is worth confirming, and the wording says
    // exactly where they land.
    const ok = await confirm({
      title: t('group.rescheduleAll'),
      body: t('task.rescheduleAllConfirm', { count: affected.length }),
      confirmLabel: t('group.rescheduleAll'),
    });
    if (!ok) return;

    const today = toApiDate(new Date());
    for (const item of affected) {
      // Moving to today drops the `week` label, which would otherwise put the
      // same task in two groups at once.
      /* A repeating task among them keeps its rule: this button catches up on
         what is late, and a series being late is not a reason to end it. */
      await updateTask(item.id, {
        due: dueForDate(item.due, today),
        labels: item.labels.filter((l) => l.toLowerCase() !== weekLabel().toLowerCase()),
      });
    }
    toast(t('group.rescheduleAll'));
  }

  /* A week is drawn from every project at once, so the order it is put into
     is the one Todoist keeps for lists like this one. */
  const sortedGroup = (list: typeof scoped) => sortItems(list, current.sort, childrenOf, 'day', snapshot);
  /* Dropping a task into a place in a list is always offered, whatever the
     list is sorted by: it is how you ask this view for an order of your own,
     and the drop makes it manual rather than being refused for not being
     manual already. */
  const byHand = 'day' as const;

  /* The board shows the same five buckets the list does. Without this it fell
     back to the generic grouping, which for "no grouping" is a single column
     holding the whole week: a board with one column in it.

     An empty bucket stays as long as it is somewhere you can drop work, since
     an empty column is still a destination; Behind schedule and Scheduled
     today are neither, so an empty one is just noise. */
  const weekColumns = useMemo(() => {
    const today = [
      { id: 'overdue', title: t('group.overdue'), items: groups.overdue },
      ...(prefs.showQuickGroup
        ? [{ id: 'quick', title: t('group.quick'), items: groups.quick,
            dropTarget: { kind: 'quick' as const } }]
        : []),
      { id: 'untimed', title: t('group.untimed'), items: groups.untimed,
        dropTarget: { kind: 'today' as const } },
      { id: 'timed', title: t('group.timed'), items: groups.timed },
    ];
    const anytime = [
      { id: 'anytime', title: t('group.anytime'), items: groups.anytime,
        dropTarget: { kind: 'anytime' as const } },
    ];
    const columns =
      scope === 'today' ? today : scope === 'anytime' ? anytime : [...today, ...anytime];
    return columns
      .filter((column) => column.items.length > 0 || column.dropTarget)
      .map((column) => ({
        ...column, items: sortItems(column.items, current.sort, childrenOf, 'day', snapshot),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, prefs.showQuickGroup, current.sort, childrenOf, snapshot, t, scope]);

  return (
    <div className="page">
      <PageHeader
        title={t(scope === 'today' ? 'nav.today' : 'nav.week')}
        actions={
          <>
            <DisplayMenu
              viewKey={viewKey}
              modes={['list', 'board']}
              groups={['none', 'project', 'priority', 'label', 'estimate']}
            />
            <button className="btn accent" onClick={onInsights}>
              <Icon name="trend" />
              {t('toolbar.insights')}
            </button>
          </>
        }
        load={load}
        onOpenUnestimated={load.unestimatedCount > 0 ? onUnestimated : undefined}
      />


      {current.mode === 'list' && current.group === 'none' ? (
        <div className="mode">
          {scope !== 'anytime' && (
          <>
          <TaskGroup
            title={t('group.overdue')}
            items={sortedGroup(groups.overdue)}
            childrenOf={childrenOf}
            onOpen={onOpen}
            reorderable={byHand}
            viewKey={viewKey}
            accent="late"
            /* Behind schedule takes no drop and no new task of its own:
               nothing is filed as late on purpose, and a task typed here would
               leave the group the moment it was saved. */
            actions={
              <button
                className="btn sm linklike"
                onClick={() => void rescheduleOverdue()}
                title={t('group.rescheduleAllHint')}
              >
                {t('group.rescheduleAll')}
              </button>
            }
          />

          {prefs.showQuickGroup && (
            <TaskGroup
              title={t('group.quick')}
              items={sortedGroup(groups.quick)}
              childrenOf={childrenOf}
              onOpen={onOpen}
              reorderable={byHand}
              viewKey={viewKey}
              accent="quick"
              dropTarget={{ kind: 'quick' }}
              onAddTask={() => onAddTaskTo(placementFor({ kind: 'quick' }))}
            />
          )}

          <TaskGroup
            title={t('group.untimed')}
            items={sortedGroup(groups.untimed)}
            childrenOf={childrenOf}
            onOpen={onOpen}
            reorderable={byHand}
            viewKey={viewKey}
            dropTarget={{ kind: 'today' }}
            onAddTask={() => onAddTaskTo(placementFor({ kind: 'today' }))}
          />

          <TaskGroup
            title={t('group.timed')}
            items={groups.timed}
            childrenOf={childrenOf}
            onOpen={onOpen}
            onAddTask={() => onAddTaskTo(placementFor({ kind: 'today' }))}
          />
          </>
          )}

          {scope !== 'today' && (
            <TaskGroup
              title={t('group.anytime')}
              items={sortedGroup(groups.anytime)}
              childrenOf={childrenOf}
              onOpen={onOpen}
              reorderable={byHand}
              viewKey={viewKey}
              dropTarget={{ kind: 'anytime' }}
              onAddTask={() => onAddTaskTo(placementFor({ kind: 'anytime' }))}
            />
          )}

          {scoped.length === 0 && <p className="empty">{t('task.noTasks')}</p>}
        </div>
      ) : (
        <ModeSurface
          items={scoped}
          childrenOf={childrenOf}
          mode={current.mode}
          group={current.group}
          sort={current.sort}
          order="day"
          onOpen={onOpen}
          /* Only when nothing else was asked for: a board grouped by project
             is a board of projects, not of the week's buckets. */
          boardColumns={
            current.mode === 'board' && current.group === 'none' ? weekColumns : undefined
          }
          addToGroup={(key) => {
            const place = addToGroupFor(current.group, key);
            return place && (() => onAddTaskTo(place));
          }}
        />
      )}
    </div>
  );
}

/**
 * The page, with the subtask filter in force around it.
 *
 * "Show subtasks" belongs to this view's display preferences, and the rows that
 * obey it are several components down; the context is set here, where the
 * preference is known, rather than passed through every group and column.
 */
export function WeekView(props: WeekViewProps) {
  const prefs = useStore((s) => s.prefs);
  const { filters } = viewPrefs(prefs, props.scope === 'today' ? 'today' : 'week');
  return (
    <SubtasksProvider value={filters.showSubtasks}>
      <WeekBody {...props} />
    </SubtasksProvider>
  );
}
