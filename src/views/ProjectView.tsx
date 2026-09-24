import { useEffect, useMemo, useState, Fragment } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SubtasksProvider } from '@/components/TaskRow';
import { DisplayMenu } from '@/components/DisplayMenu';
import { TaskGroup } from '@/components/TaskGroup';
import { ModeSurface } from '@/components/ModeSurface';
import { EditableDescription } from '@/components/EditableDescription';
import { EditableTitle } from '@/components/EditableTitle';
import { ProjectMenu } from '@/components/ProjectMenu';
import type { ProjectSheetTarget } from '@/components/overlays/ProjectSheet';
import { AddSectionLine } from '@/components/AddSectionLine';
import { useConfirm } from '@/components/overlays/Confirm';
import { Icon } from '@/components/Icon';
import { useT } from '@/hooks/useT';
import type { TaskPlacement } from '@/domain/dnd';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { viewPrefs } from '@/store/prefs';
import { applyFilters, rootItems, sortItems } from '@/store/selectors';
import { summariseLoad } from '@/domain/load';
import { readProjectIcon, stripProjectIcon, withProjectIcon } from '@/domain/projectIcons';
import { bySectionOrder } from '@/domain/orderKey';

interface ProjectViewProps {
  projectId: string;
  revealSectionId?: string;
  onOpen: (id: string) => void;
  onInsights: () => void;
  onUnestimated: () => void;
  /** Adds a task straight into a section of this project. */
  onAddTaskTo: (placement: TaskPlacement) => void;
  /** Opens the project sheet, to edit this one or add one beside it. */
  onProjectSheet: (target: ProjectSheetTarget) => void;
}

/**
 * A project page.
 *
 * By default the page is laid out by the project's own sections, which is how
 * the work is already organised in Todoist. Splitting it into scheduled and
 * available work stays available as an explicit grouping.
 */
/**
 * The priority a `priority` group's key stands for.
 *
 * A group only ever offers what its own heading already fixes. Priority is
 * one of those: a column headed P2 knows every task in it is a P2, so the
 * line at the bottom of it can say so and leave everything else alone.
 */
const priorityOf = (key: string): 1 | 2 | 3 | 4 | undefined => {
  const at = Number(key.replace('p', ''));
  return at >= 1 && at <= 4 ? (at as 1 | 2 | 3 | 4) : undefined;
};

function ProjectBody({
  projectId, revealSectionId, onOpen, onInsights, onUnestimated, onAddTaskTo, onProjectSheet,
}: ProjectViewProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { t } = useT();
  const { snapshot, items, childrenOf } = useData();
  const prefs = useStore((s) => s.prefs);
  const updateProjectFields = useStore((s) => s.updateProjectFields);
  const updateSectionFields = useStore((s) => s.updateSectionFields);
  const createSection = useStore((s) => s.createSection);
  const removeSection = useStore((s) => s.removeSection);
  const confirm = useConfirm();

  /* Deleting a section is always confirmed, and the confirmation says what
     becomes of its tasks: they stay in the project, without a section. */
  const deleteSection = async (group: { id: string; title: string; items: unknown[] }) => {
    const ok = await confirm({
      title: t('section.deleteTitle'),
      body: group.items.length === 0
        ? t('section.deleteEmpty', { name: group.title || t('section.untitled') })
        : t('section.deleteBody', {
            name: group.title || t('section.untitled'),
            count: group.items.length,
          }),
      confirmLabel: t('section.delete'),
      destructive: true,
    });
    if (ok) await removeSection(group.id);
  };

  const addSection = async (index: number) => {
    const id = await createSection(projectId, index);

    /* The field does not exist until React has rendered the new section, and
       one frame is not always enough — the store updates, then the view
       re-renders. Poll briefly rather than guess a delay. */
    let tries = 0;
    const focus = () => {
      const field = document.querySelector<HTMLInputElement>(`[data-section-name="${id}"]`);
      field?.focus();
      field?.select();
      // The click that created the section also re-renders the list around it,
      // which hands focus back to the body; keep asking until it sticks.
      if (document.activeElement !== field && tries++ < 30) setTimeout(focus, 30);
    };
    setTimeout(focus, 30);
  };
  const viewKey = `project:${projectId}`;
  const current = viewPrefs(prefs, viewKey);

  const project = snapshot.projects[projectId];

  /*
   * A completed task is not a section of its own — it belongs wherever its
   * own properties already put an open one: no section is the loose block
   * above the sections, a real section is that section, P1 is the P1 column.
   * So rather than a separate list, it's folded in here, upstream of every
   * grouping below, and comes out the other side sitting where it belongs.
   *
   * Todoist keeps a completed task in `snapshot.items` (checked, but
   * otherwise intact — see ReviewView's own DoneRow), which is what makes
   * this possible without a second fetch.
   */
  const scoped = useMemo(() => {
    const openRoots = rootItems(items).filter((i) => i.project_id === projectId);
    const roots = current.filters.showCompleted
      ? [
          ...openRoots,
          ...Object.values(snapshot.items).filter(
            (i) => i.project_id === projectId && i.checked && !i.is_deleted && !i.parent_id,
          ),
        ]
      : openRoots;
    return applyFilters(roots, current.filters, snapshot, childrenOf);
  }, [items, projectId, current.filters, snapshot, childrenOf]);

  const load = useMemo(() => summariseLoad(scoped, childrenOf, null), [scoped, childrenOf]);

  const sections = useMemo(
    () =>
      Object.values(snapshot.sections)
        .filter((s) => s.project_id === projectId && !s.is_archived && !s.is_deleted)
        .sort(bySectionOrder),
    [snapshot.sections, projectId],
  );

  const sorted = (list: typeof scoped) => sortItems(list, current.sort, childrenOf, 'project', snapshot);

  /**
   * The tasks in the project itself, in no section.
   *
   * They lead the page, above the sections, and they are not given a heading:
   * "no section" is not a section, and putting them in a group called that
   * invents a container you never made and buries the loose work at the
   * bottom. The board has always read them this way; the list now agrees.
   */
  const looseItems = useMemo(
    () => sorted(scoped.filter((i) => !i.section_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, current.sort, childrenOf],
  );

  const sectionGroups = useMemo(
    () =>
      sections.map((section) => ({
        id: section.id,
        title: section.name,
        items: sorted(scoped.filter((i) => i.section_id === section.id)),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, scoped, current.sort, childrenOf],
  );

  useEffect(() => {
    if (!revealSectionId || !sections.some((section) => section.id === revealSectionId)) return;
    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      const field = document.querySelector<HTMLElement>(`[data-section-name="${CSS.escape(revealSectionId)}"]`);
      const group = field?.closest<HTMLElement>('.group');
      if (!group) { window.setTimeout(reveal, 30); return; }
      group.scrollIntoView({ block: 'center', behavior: 'smooth' });
      group.classList.add('section-reveal');
      window.setTimeout(() => group.classList.remove('section-reveal'), 1800);
    };
    window.setTimeout(reveal, 0);
    return () => { cancelled = true; };
  }, [revealSectionId, sections]);

  const boardColumns = useMemo(
    () =>
      [
        // An empty "no section" column is noise; a real section stays, because
        // an empty column of your own is still somewhere to drop work. The
        // column keeps a name, unlike the list: a board column with no header
        // is a stack of cards floating beside labelled ones.
        ...(looseItems.length > 0
          ? [{ id: 'none', title: t('group.noSection'), items: looseItems }]
          : []),
        ...sectionGroups,
      ]
        .map((group) => ({
          id: group.id,
          title: group.title,
          items: group.items,
          dropTarget: {
            kind: 'section' as const,
            sectionId: group.id === 'none' ? null : group.id,
            projectId,
          },
          onAddTask: () => onAddTaskTo(
            group.id === 'none' ? { projectId } : { projectId, sectionId: group.id },
          ),
        })),
    [sectionGroups, looseItems, projectId, t, onAddTaskTo],
  );

  if (!project) {
    return <div className="page"><p className="empty">{t('common.error')}</p></div>;
  }

  // A Kanban is only offered where sections exist to give it columns.

  return (
    <div className="page">
      <PageHeader
        title={
          <EditableTitle
            value={project.name}
            label={t('project.rename')}
            onCommit={(next) => void updateProjectFields(projectId, { name: next })}
          />
        }
        subtitle={
          <EditableDescription
            value={stripProjectIcon(project.description)}
            placeholder={t('project.editDescription')}
            /* An icon chosen from the project sheet rides on the end of the
               same field (see domain/projectIcons.ts) — editing the visible
               text here must not carry it off. */
            onCommit={(next) => void updateProjectFields(projectId, {
              description: withProjectIcon(next, readProjectIcon(project.description)),
            })}
          />
        }
        actions={
          <>
            <DisplayMenu
              viewKey={viewKey}
              modes={['list', 'board']}
              groups={['none', 'scheduled', 'priority', 'label', 'estimate', 'day']}
              completedToggle
              showWorkspaces={false}
            />
            <button className="btn accent" onClick={onInsights}>
              <Icon name="trend" />
              {t('toolbar.insights')}
            </button>
            {/* The same menu the sidebar row carries, asked from the page it
                is about. */}
            <span className="pmenu-wrap">
              <button
                className="iconbtn"
                aria-label={t('project.actions')}
                title={t('project.actions')}
                aria-expanded={menuAnchor !== null}
                aria-haspopup="menu"
                onClick={(event) => {
                  /* Read out of the event now: a state updater runs after the
                     handler returns, and React has emptied currentTarget by
                     then, so the menu would open with nothing to hang from. */
                  const button = event.currentTarget;
                  setMenuAnchor((current) => (current ? null : button));
                }}
              >
                <Icon name="more" />
              </button>
              {menuAnchor && (
                <ProjectMenu
                  project={project}
                  align="right"
                  anchor={menuAnchor}
                  onClose={() => setMenuAnchor(null)}
                  onEdit={() => onProjectSheet({ mode: 'edit', projectId })}
                />
              )}
            </span>
          </>
        }
        load={load}
        onOpenUnestimated={load.unestimatedCount > 0 ? onUnestimated : undefined}
      />


      {current.mode === 'board' ? (
        <ModeSurface
          items={scoped}
          childrenOf={childrenOf}
          mode="board"
          group={current.group}
          sort={current.sort}
          onOpen={onOpen}
          showProject={false}
          boardColumns={current.group === 'none' ? boardColumns : undefined}
          addToGroup={(key) => {
            if (current.group === 'day' && key !== 'none') {
              return () => onAddTaskTo({ projectId, date: key });
            }
            if (current.group === 'label' && key !== 'none') {
              return () => onAddTaskTo({ projectId, labels: [key] });
            }
            if (current.group === 'priority') {
              const priority = priorityOf(key);
              if (priority) return () => onAddTaskTo({ projectId, priority });
            }
            return () => onAddTaskTo({ projectId });
          }}
        />
      ) : current.mode === 'list' && current.group === 'none' ? (
        <div className="mode">
          {/* The project's own tasks, first and unlabelled: they are in the
              project, not in a section that happens to be called nothing. */}
          <TaskGroup
            items={looseItems}
            childrenOf={childrenOf}
            onOpen={onOpen}
            showProject={false}
            dropTarget={{ kind: 'section', sectionId: null, projectId }}
            onAddTask={() => onAddTaskTo({ projectId })}
            /* A row dropped into another's place under a sort that would put
               it straight back used to be refused the drop. It is taken now,
               and the sort gives way instead: putting a task somewhere by
               hand is the whole of what "arranged by hand" means. */
            reorderable="project"
            viewKey={viewKey}
            /* A project with everything in sections still needs somewhere to
               put a task that belongs in none of them. */
            keepWhenEmpty
          />
          {sectionGroups.map((group, index) => (
            <Fragment key={group.id}>
            <AddSectionLine
              label={t('section.add')}
              slotId={String(index)}
              onAdd={() => void addSection(index)}
            />
            <TaskGroup
              title={group.title}
              sectionId={group.id}
              onRename={(name) => void updateSectionFields(group.id, { name })}
              onDelete={() => void deleteSection(group)}
              items={group.items}
              childrenOf={childrenOf}
              onOpen={onOpen}
              showProject={false}
              dropTarget={{ kind: 'section', sectionId: group.id, projectId }}
              onAddTask={() => onAddTaskTo({ projectId, sectionId: group.id })}
              reorderable="project"
              viewKey={viewKey}
            />
            </Fragment>
          ))}
          <AddSectionLine
            label={t('section.add')}
            slotId={String(sections.length)}
            onAdd={() => void addSection(sections.length)}
          />
          {scoped.length === 0 && <p className="empty">{t('task.noTasks')}</p>}
        </div>
      ) : current.mode === 'list' && current.group === 'scheduled' ? (
        <div className="mode">
          <TaskGroup
            title={t('section.scheduled')}
            items={sorted(scoped.filter((i) => i.due !== null))}
            childrenOf={childrenOf}
            onOpen={onOpen}
            showProject={false}
            onAddTask={() => onAddTaskTo({ projectId })}
          />
          <TaskGroup
            title={t('section.available')}
            items={sorted(scoped.filter((i) => i.due === null))}
            childrenOf={childrenOf}
            onOpen={onOpen}
            showProject={false}
            onAddTask={() => onAddTaskTo({ projectId })}
          />
          {scoped.length === 0 && <p className="empty">{t('task.noTasks')}</p>}
        </div>
      ) : (
        <ModeSurface
          items={scoped}
          childrenOf={childrenOf}
          mode={current.mode}
          group={current.group}
          sort={current.sort}
          onOpen={onOpen}
          showProject={false}
          /* A day column and a tag column are places inside this project; a
             priority column is not one, and says nothing. */
          /* The page already fixes the project; the column fixes one more
             thing. Grouped by priority there was no line at all, which made
             no sense on the one page where both halves of the answer are
             known. */
          addToGroup={(key) => {
            if (current.group === 'day' && key !== 'none') {
              return () => onAddTaskTo({ projectId, date: key });
            }
            if (current.group === 'label' && key !== 'none') {
              return () => onAddTaskTo({ projectId, labels: [key] });
            }
            if (current.group === 'priority') {
              const priority = priorityOf(key);
              if (priority) return () => onAddTaskTo({ projectId, priority });
            }
            if (current.group === 'section') {
              return () => onAddTaskTo({ projectId, sectionId: key === 'none' ? undefined : key });
            }
            return () => onAddTaskTo({ projectId });
          }}
        />
      )}
    </div>
  );
}

export function ProjectView(props: ProjectViewProps) {
  const prefs = useStore((s) => s.prefs);
  return (
    <SubtasksProvider value={viewPrefs(prefs, `project:${props.projectId}`).filters.showSubtasks}>
      <ProjectBody {...props} />
    </SubtasksProvider>
  );
}
