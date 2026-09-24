import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Overlay } from './Overlay';
import { Icon, type IconName } from '../Icon';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { navigate } from '@/hooks/useRoute';
import { markerStyle } from '@/domain/colors';
import { useStore } from '@/store/store';
import { bySectionOrder } from '@/domain/orderKey';

interface SearchProps {
  open: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  /**
   * What was already typed when the search opened.
   *
   * Typing on a page with no cursor on it opens this with the letter in it, so
   * the first keystroke is not the one that gets eaten by the shortcut that
   * opened the field.
   */
  seed?: string;
}

/** Accents set aside, so "reglages" finds "Réglages". */
const fold = (text: string): string =>
  text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** One row of the result list, whatever kind of thing it points at. */
interface Hit {
  key: string;
  heading?: string;
  icon?: IconName;
  marker?: ReactNode;
  title: string;
  detail?: string;
  run: () => void;
}

/**
 * Global search across tasks, projects and tags, run over the local mirror.
 *
 * The list is driven from the keyboard: the field keeps focus, the arrows move
 * a cursor through the results and Enter opens the one under it. A palette you
 * have to reach for the mouse in the middle of is not a palette.
 */
export function Search({ open, onClose, onOpen, seed = '' }: SearchProps) {
  const { t } = useT();
  const { snapshot, items } = useData();
  const includeSections = useStore((s) => s.prefs.includeSectionsInSearch);
  const eisenhowerEnabled = useStore((s) => s.prefs.eisenhowerEnabled);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQuery(seed); setCursor(0); }
    /* `seed` deliberately left out: it is read at the moment of opening, and
       nothing that changes it afterwards should retype the field under
       somebody's hands. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Everywhere the app can go.
   *
   * The same list whether or not anything has been typed: it used to be shown
   * on opening and then thrown away the moment you touched a key, so typing
   * "settings" — the fastest way anybody would try to reach settings — found
   * nothing but tasks with the word in them.
   */
  const destinations: Hit[] = useMemo(() => {
    const go = (run: () => void) => () => { run(); onClose(); };
    return [
      { key: 'go-inbox', icon: 'inbox', title: t('nav.inbox'), run: go(() => navigate('inbox')) },
      { key: 'go-today', icon: 'calendar', title: t('nav.today'), run: go(() => navigate('today')) },
      { key: 'go-week', icon: 'week', title: t('nav.week'), run: go(() => navigate('week')) },
      { key: 'go-upcoming', icon: 'upcoming', title: t('nav.upcoming'),
        run: go(() => navigate('upcoming')) },
      { key: 'go-someday', icon: 'someday', title: t('nav.someday'),
        run: go(() => navigate('someday')) },
      { key: 'go-review', icon: 'check', title: t('nav.review'),
        run: go(() => navigate('review')) },
      ...(eisenhowerEnabled ? [{
        key: 'go-matrix', icon: 'dashboard' as const, title: t('nav.matrix'),
        run: go(() => navigate('matrix')),
      }] : []),
      { key: 'go-labels', icon: 'tag', title: t('nav.labels'),
        run: go(() => navigate('labels')) },
      { key: 'go-dashboard', icon: 'trend', title: t('nav.dashboard'),
        run: go(() => navigate('insights')) },
      { key: 'go-logbook', icon: 'tasks', title: t('insights.logbook'),
        run: go(() => navigate('insights', 'logbook')) },
      { key: 'go-settings', icon: 'settings', title: t('nav.settings'),
        run: go(() => navigate('settings')) },
    ];
  }, [t, onClose, eisenhowerEnabled]);

  const hits: Hit[] = useMemo(() => {
    const go = (run: () => void) => () => { run(); onClose(); };
    const q = fold(query);

    if (!q) {
      return destinations.map((hit, index) => ({
        ...hit,
        heading: index === 0 ? t('search.quickAccess') : undefined,
      }));
    }

    /* Destinations first, because a palette is reached for to go somewhere
       more often than to find one task among four hundred. */
    const places = destinations
      .filter((hit) => fold(hit.title).includes(q))
      .map((hit, index) => ({ ...hit, heading: index === 0 ? t('search.goTo') : undefined }));

    const tasks = items
      .filter((i) => fold(i.content).includes(q) || fold(i.description).includes(q))
      .slice(0, 12)
      .map((item, index): Hit => ({
        key: `task-${item.id}`,
        heading: index === 0 ? t('search.tasks') : undefined,
        icon: 'tasks',
        title: item.content,
        detail: snapshot.projects[item.project_id]?.name ?? '',
        run: go(() => onOpen(item.id)),
      }));

    const sections = includeSections
      ? Object.values(snapshot.sections)
        .filter((section) => {
          const parent = snapshot.projects[section.project_id];
          return !section.is_archived && !section.is_deleted
            && parent && !parent.is_archived && !parent.is_deleted
            && fold(section.name).includes(q);
        })
        .sort((a, b) => {
          const aExact = fold(a.name) === q ? 0 : 1;
          const bExact = fold(b.name) === q ? 0 : 1;
          return aExact - bExact || bySectionOrder(a, b);
        })
        .slice(0, 6)
        .map((section, index): Hit => {
          const parent = snapshot.projects[section.project_id];
          return {
            key: `section-${section.id}`,
            heading: index === 0 ? t('search.sections') : undefined,
            icon: 'section',
            title: section.name,
            detail: parent?.name ?? '',
            /* Resolve again on selection. A stale palette falls back to the
               parent project instead of manufacturing a broken destination. */
            run: go(() => {
              const current = snapshot.sections[section.id];
              navigate(
                'project',
                current?.project_id ?? section.project_id,
                current ? { sectionId: current.id } : undefined,
              );
            }),
          };
        })
      : [];

    const projects = Object.values(snapshot.projects)
      .filter((p) => !p.is_archived && !p.is_deleted && fold(p.name).includes(q))
      .slice(0, 6)
      .map((project, index): Hit => ({
        key: `project-${project.id}`,
        heading: index === 0 ? t('search.projects') : undefined,
        marker: <span className="hash" style={markerStyle(project.color)}>#</span>,
        title: project.name,
        run: go(() => navigate('project', project.id)),
      }));

    const labels = Object.values(snapshot.labels)
      .filter((l) => fold(l.name).includes(q) && !l.name.startsWith('est-'))
      .slice(0, 6)
      .map((label, index): Hit => ({
        key: `label-${label.id}`,
        heading: index === 0 ? t('search.labels') : undefined,
        icon: 'tag',
        title: label.name,
        run: go(() => navigate('label', label.name)),
      }));

    return [...places, ...sections, ...tasks, ...projects, ...labels];
  }, [query, items, snapshot, includeSections, onOpen, onClose, t, destinations]);

  // A new query invalidates wherever the cursor was.
  useEffect(() => { setCursor(0); }, [query]);

  // Keep the row under the cursor on screen while the arrows move it.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const empty = query.trim() !== '' && hits.length === 0;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      hits[Math.min(cursor, hits.length - 1)]?.run();
    }
  };

  return (
    <Overlay open={open} onClose={onClose} label={t('nav.search')} size="search">
      <div className="searchfield">
        <Icon name="search" />
        <input
          type="search"
          placeholder={t(includeSections ? 'search.placeholderWithSections' : 'search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('nav.search')}
          aria-activedescendant={hits[cursor]?.key}
          autoFocus
        />
        <kbd>Esc</kbd>
      </div>

      <div className="sresults" ref={listRef} role="listbox">
        {hits.map((hit, index) => (
          <div key={hit.key}>
            {hit.heading && <h4>{hit.heading}</h4>}
            <button
              id={hit.key}
              role="option"
              aria-selected={index === cursor}
              onMouseEnter={() => setCursor(index)}
              onClick={hit.run}
            >
              {hit.marker ?? (hit.icon && <Icon name={hit.icon} />)}
              <span>
                <strong>{hit.title}</strong>
                {hit.detail && <small>{hit.detail}</small>}
              </span>
            </button>
          </div>
        ))}

        {empty && <p className="empty">{t('search.noResults')}</p>}
      </div>

      <div className="searchfoot">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t('search.hintMove')}</span>
        <span><kbd>↵</kbd> {t('search.hintOpen')}</span>
      </div>
    </Overlay>
  );
}
