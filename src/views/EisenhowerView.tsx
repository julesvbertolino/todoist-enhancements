import { useMemo } from 'react';
import { EisenhowerDisplayMenu } from '@/components/EisenhowerDisplayMenu';
import { PageHeader } from '@/components/PageHeader';
import { SubtasksProvider } from '@/components/TaskRow';
import { TaskGroup } from '@/components/TaskGroup';
import { useData } from '@/hooks/useData';
import { useT } from '@/hooks/useT';
import {
  EISENHOWER_QUADRANTS, eisenhowerQuadrant, sortEisenhower,
  type EisenhowerQuadrant,
} from '@/domain/eisenhower';
import { summariseLoad } from '@/domain/load';
import { bucketOf } from '@/domain/views';
import { PERSONAL_WORKSPACE, rootItems } from '@/store/selectors';
import { useStore } from '@/store/store';
import type { TranslationKey } from '@/i18n';

interface EisenhowerViewProps {
  onOpen: (id: string) => void;
  onUnestimated: () => void;
}

export function EisenhowerView({ onOpen, onUnestimated }: EisenhowerViewProps) {
  const { t } = useT();
  const { snapshot, items, childrenOf } = useData();
  const layout = useStore((s) => s.prefs.eisenhowerLayout);
  const urgentRules = useStore((s) => s.prefs.eisenhowerUrgent);
  const importantPriorities = useStore((s) => s.prefs.eisenhowerImportant);
  const showFuture = useStore((s) => s.prefs.eisenhowerShowFuture);
  const includeSomeday = useStore((s) => s.prefs.eisenhowerIncludeSomeday);
  const workspaceFilter = useStore((s) => s.prefs.eisenhowerWorkspace);
  const weekLabel = useStore((s) => s.prefs.weekLabel);
  const roots = useMemo(() => rootItems(items), [items]);
  const visibleItems = useMemo(() => {
    const now = new Date();
    return roots.filter((item) => {
      const bucket = bucketOf(item, now);
      if (!showFuture && bucket === 'upcoming') return false;
      if (!includeSomeday && bucket === 'someday') return false;
      if (workspaceFilter) {
        const workspaceId = snapshot.projects[item.project_id]?.workspace_id ?? null;
        const bucket = workspaceId ?? PERSONAL_WORKSPACE;
        if (bucket !== workspaceFilter) return false;
      }
      return true;
    });
  }, [roots, showFuture, includeSomeday, workspaceFilter, snapshot.projects]);
  const load = useMemo(
    () => summariseLoad(visibleItems, childrenOf, null),
    [visibleItems, childrenOf],
  );

  const groups = useMemo(() => {
    const now = new Date();
    return Object.fromEntries(EISENHOWER_QUADRANTS.map((quadrant) => [
      quadrant,
      sortEisenhower(visibleItems.filter((item) =>
        eisenhowerQuadrant(
          item, now, urgentRules, importantPriorities, weekLabel,
        ) === quadrant)),
    ])) as Record<EisenhowerQuadrant, typeof roots>;
  }, [visibleItems, roots, urgentRules, importantPriorities, weekLabel]);

  return (
    <div className="page eisenhower-page">
      <PageHeader
        title={t('matrix.title')}
        load={load}
        onOpenUnestimated={load.unestimatedCount > 0 ? onUnestimated : undefined}
        actions={<EisenhowerDisplayMenu />}
      />

      <SubtasksProvider value={false}>
        <div className={layout === 'matrix' ? 'eisenhower-grid' : 'eisenhower-list'}>
          {EISENHOWER_QUADRANTS.map((quadrant) => (
            <div className={`quadrant ${quadrant}`} key={quadrant}>
              <TaskGroup
                title={t(`matrix.${quadrant}.title` as TranslationKey)}
                items={groups[quadrant]}
                childrenOf={childrenOf}
                onOpen={onOpen}
                showProject
                keepWhenEmpty
                draggable={false}
              />
            </div>
          ))}
        </div>
      </SubtasksProvider>
    </div>
  );
}
