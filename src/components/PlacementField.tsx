import { useMemo } from 'react';
import { Select } from './Select';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { byChildOrder, bySectionOrder } from '@/domain/orderKey';

/** Where a task lives: a project, and at most one of its sections. */
export interface Placement {
  projectId: string;
  sectionId: string | null;
}

const asValue = (placement: Placement): string =>
  (placement.sectionId ? `section:${placement.sectionId}` : `project:${placement.projectId}`);

interface PlacementFieldProps {
  label?: string;
  ariaLabel?: string;
  value: Placement;
  onChange: (placement: Placement) => void;
}

/**
 * The one field that says where a task lives.
 *
 * A section is not a second decision taken after the project: it is a place in
 * Todoist, the way the row's move menu has always offered it, and asking for
 * it in a field of its own meant choosing a project, watching a second field
 * appear, and choosing again. So the sections are listed under their project,
 * indented, and picking one says both things at once.
 */
export function PlacementField({ label, ariaLabel, value, onChange }: PlacementFieldProps) {
  const { t } = useT();
  const projects = useStore((s) => s.snapshot.projects);
  const sections = useStore((s) => s.snapshot.sections);

  const { options, places } = useMemo(() => {
    const live = Object.values(sections)
      .filter((s) => !s.is_deleted && !s.is_archived)
      .sort(bySectionOrder);

    const places = new Map<string, Placement>();
    const options = Object.values(projects)
      .filter((p) => !p.is_deleted && !p.is_archived && !p.is_folder)
      .sort(byChildOrder)
      .flatMap((project) => {
        const name = project.inbox_project ? t('nav.inbox') : project.name;
        places.set(`project:${project.id}`, { projectId: project.id, sectionId: null });
        return [
          { value: `project:${project.id}`, label: name, marker: project.color },
          ...live
            .filter((section) => section.project_id === project.id)
            .map((section) => {
              places.set(`section:${section.id}`, {
                projectId: project.id, sectionId: section.id,
              });
              const title = section.name || t('section.untitled');
              return {
                value: `section:${section.id}`,
                label: title,
                icon: 'section' as const,
                sub: true,
                /* Read on its own, out of the list, a section name says nothing
                   about where it is. */
                face: `${name} / ${title}`,
              };
            }),
        ];
      });

    return { options, places };
  }, [projects, sections, t]);

  return (
    <Select
      label={label}
      ariaLabel={ariaLabel ?? label}
      value={asValue(value)}
      options={options}
      onChange={(next) => {
        const place = places.get(next);
        if (place) onChange(place);
      }}
    />
  );
}
