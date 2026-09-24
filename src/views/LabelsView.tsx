import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { navigate } from '@/hooks/useRoute';
import { useTagDrag, useTagTopDrop } from '@/components/dnd/DraggableTag';
import { rootItems } from '@/store/selectors';
import { hasLabel } from '@/domain/views';
import { markerStyle } from '@/domain/colors';
import type { Label } from '@/domain/types';
import { byLabelOrder } from '@/domain/orderKey';

/**
 * Every tag on the account, in the order Todoist keeps them.
 *
 * Favourites are Todoist's own star, not a separate list this app keeps, so
 * starring here pins the tag in both products at once. The order is Todoist's
 * too: drag a tag and the sidebar's favourites follow.
 */
export function LabelsView() {
  const { t } = useT();
  const { snapshot, items } = useData();
  const updateLabelFavourite = useStore((s) => s.setLabelFavourite);
  const createLabel = useStore((s) => s.createLabel);
  const [draft, setDraft] = useState('');
  const { topDropRef, isTopOver } = useTagTopDrop();

  const roots = useMemo(() => rootItems(items), [items]);

  const labels = useMemo(
    () =>
      Object.values(snapshot.labels)
        .filter((l) => !l.is_deleted && !l.name.startsWith('est-'))
        .sort(byLabelOrder),
    [snapshot.labels],
  );

  /* This list used to open a drag context of its own, on the grounds that a
     tag being reordered is not a task being filed. True, but the cost was
     that a tag could only ever be dropped inside this page: a nested context
     owns the pointer outright, so dragging a tag to the sidebar's Favourites
     reached nothing. It registers in the app's one context now, like the
     sidebar's projects and a project's sections already do, and the drop is
     read in `DragProvider` with every other drop.

     The order the rows are drawn in is handed over with them, because the
     provider reorders by position in a list and this is the list. */
  return (
    <div className="page">
      <div className="phead">
        <div className="phead-text">
          <h1 className="ptitle">{t('nav.labels')}</h1>
          {labels.length > 1 && <p className="psub">{t('labels.orderHint')}</p>}
        </div>
      </div>

      {/* A tag is a name and nothing else, so making one is a line to type in
          rather than a dialog to open. Its colour and its star are set on the
          card it becomes, which is right there underneath. */}
      <form
        className="mode tagadd"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          if (!name) return;
          void createLabel(name);
          setDraft('');
        }}
      >
        <Icon name="tag" size="sm" />
        <input
          value={draft}
          placeholder={t('labels.newPlaceholder')}
          aria-label={t('nav.addTag')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); e.currentTarget.blur(); } }}
        />
        <button className="btn quiet" type="submit" disabled={!draft.trim()}>
          {t('nav.addTag')}
        </button>
      </form>

      {labels.length === 0 ? (
        <p className="empty">{t('labels.none')}</p>
      ) : (
        <div className="mode taglist">
          <div
            ref={topDropRef}
            className={`tagdrop-top${isTopOver ? ' over' : ''}`}
            aria-hidden="true"
          />
          {labels.map((label) => (
            <TagRow
              key={label.id}
              label={label}
              order={labels.map((l) => l.name)}
              count={roots.filter((i) => hasLabel(i, label.name)).length}
              onToggleFavourite={() => void updateLabelFavourite(label.id, !label.is_favorite)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TagRow({
  label, count, order, onToggleFavourite,
}: {
  label: Label;
  count: number;
  /** The names of every row on the page, in the order they are drawn. */
  order: string[];
  onToggleFavourite: () => void;
}) {
  const { t } = useT();
  const { grip, row, isDragging, isOver } = useTagDrag(label.name, order);

  return (
    <div
      ref={row}
      className={`tagcard${isDragging ? ' dragging' : ''}${isOver ? ' landing' : ''}`}
    >
      <button
        className="tagcard-grip"
        aria-label={t('labels.reorder')}
        title={t('labels.reorder')}
        {...grip}
      >
        <Icon name="drag" size="sm" />
      </button>

      <button className="tagcard-open" onClick={() => navigate('label', label.name)}>
        <span className="tagcard-mark" style={markerStyle(label.color)}>
          <Icon name="tag" />
        </span>
        <span className="tagcard-text">
          <strong>{label.name}</strong>
          <small>{t('metrics.tasks', { count })}</small>
        </span>
      </button>

      <button
        className={`tagcard-star${label.is_favorite ? ' on' : ''}`}
        aria-pressed={label.is_favorite}
        aria-label={label.is_favorite ? t('labels.unfavourite') : t('labels.favourite')}
        title={label.is_favorite ? t('labels.unfavourite') : t('labels.favourite')}
        onClick={onToggleFavourite}
      >
        <Icon name="star" />
      </button>
    </div>
  );
}
