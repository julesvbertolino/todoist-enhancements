import { request } from './client';
import type {
  Collaborator, Item, Label, Note, Project, Reminder,
  Section, Snapshot, TodoistUser, Workspace,
} from '@/domain/types';

/** The resource types the app reads. Anything else Todoist offers is ignored. */
export const SYNC_RESOURCE_TYPES = [
  'items', 'projects', 'sections', 'labels', 'notes', 'project_notes',
  'reminders', 'user', 'collaborators', 'workspaces',
] as const;

export interface SyncResponse {
  sync_token: string;
  full_sync: boolean;
  items?: Item[];
  projects?: Project[];
  sections?: Section[];
  labels?: Label[];
  notes?: Note[];
  /** Comments on projects rather than tasks; kept in the same collection as task comments. */
  project_notes?: Note[];
  reminders?: Reminder[];
  collaborators?: Collaborator[];
  workspaces?: Workspace[];
  user?: TodoistUser;
  temp_id_mapping?: Record<string, string>;
  sync_status?: Record<string, 'ok' | { error_code: number; error: string }>;
}

/**
 * Reads from Todoist.
 *
 * Passing `*` asks for everything; passing the token from the previous call
 * asks only for what changed since. The caller keeps the returned token.
 */
/** A full sync of a large account is a big download; it gets longer than the usual deadline. */
const FULL_SYNC_TIMEOUT_MS = 60_000;

export async function sync(syncToken: string, signal?: AbortSignal): Promise<SyncResponse> {
  return request<SyncResponse>('/sync', {
    method: 'POST',
    form: {
      sync_token: syncToken,
      resource_types: JSON.stringify(SYNC_RESOURCE_TYPES),
    },
    signal,
    timeoutMs: syncToken === '*' ? FULL_SYNC_TIMEOUT_MS : undefined,
  });
}

type Keyed = { id: string; is_deleted?: boolean };

/**
 * Folds a sync response into the snapshot.
 *
 * A full sync replaces a collection outright. An incremental one merges, and
 * removes anything Todoist marked deleted, so the local copy never drifts.
 */
function mergeCollection<T extends Keyed>(
  current: Record<string, T>,
  incoming: T[] | undefined,
  fullSync: boolean,
): Record<string, T> {
  if (!incoming) return fullSync ? {} : current;

  const next: Record<string, T> = fullSync ? {} : { ...current };
  for (const entry of incoming) {
    if (entry.is_deleted) delete next[entry.id];
    else next[entry.id] = entry;
  }
  return next;
}

export function applySync(snapshot: Snapshot, response: SyncResponse): Snapshot {
  const full = response.full_sync;
  return {
    items: mergeCollection(snapshot.items, response.items, full),
    projects: mergeCollection(snapshot.projects, response.projects, full),
    sections: mergeCollection(snapshot.sections, response.sections, full),
    labels: mergeCollection(snapshot.labels, response.labels, full),
    /* Task comments and project comments are one collection here, told apart
       by `item_id` / `project_id`. A full sync rebuilds it from both. */
    notes: mergeCollection(
      mergeCollection(snapshot.notes, response.notes, full),
      response.project_notes,
      false,
    ),
    reminders: mergeCollection(snapshot.reminders, response.reminders, full),
    collaborators: mergeCollection(snapshot.collaborators, response.collaborators, full),
    workspaces: mergeCollection(snapshot.workspaces, response.workspaces, full),
    user: response.user ?? snapshot.user,
    syncToken: response.sync_token,
    syncedAt: Date.now(),
  };
}

/**
 * Puts the real id in place of every temporary one Todoist has resolved.
 *
 * Something created before Todoist answered is drawn under a temporary id.
 * Once the answer maps it to a real one, the placeholder must go — or the
 * thing shows twice, the placeholder beside the real copy the same answer
 * carried — and whatever pointed at the placeholder must point at the real
 * id instead: a subtask at its parent, a task at its new project or section.
 * A placeholder whose real copy did not come back is kept, under its real id.
 */
export function resolveTempIds(snapshot: Snapshot, mapping: Record<string, string>): Snapshot {
  if (Object.keys(mapping).length === 0) return snapshot;
  const real = <V extends string | null | undefined>(id: V): V =>
    (id && mapping[id] ? mapping[id] : id) as V;

  function settle<T extends { id: string }>(
    collection: Record<string, T>,
    relink: (entry: T) => T,
  ): Record<string, T> {
    const next: Record<string, T> = {};
    for (const [id, entry] of Object.entries(collection)) {
      const resolved = mapping[id];
      if (resolved) {
        if (collection[resolved]) continue;
        next[resolved] = relink({ ...entry, id: resolved });
      } else if (!next[id]) {
        next[id] = relink(entry);
      }
    }
    return next;
  }

  const items = settle(snapshot.items, (item) => {
    const parent = real(item.parent_id);
    const project = real(item.project_id);
    const section = real(item.section_id);
    return parent === item.parent_id && project === item.project_id && section === item.section_id
      ? item
      : { ...item, parent_id: parent, project_id: project, section_id: section };
  });
  const projects = settle(snapshot.projects, (project) => {
    const parent = real(project.parent_id);
    return parent === project.parent_id ? project : { ...project, parent_id: parent };
  });
  const sections = settle(snapshot.sections, (section) => {
    const project = real(section.project_id);
    return project === section.project_id ? section : { ...section, project_id: project };
  });
  const labels = settle(snapshot.labels, (label) => label);
  const notes = settle(snapshot.notes, (note) => {
    const item = real(note.item_id);
    const project = real(note.project_id);
    return item === note.item_id && project === note.project_id
      ? note
      : { ...note, item_id: item, project_id: project };
  });

  return { ...snapshot, items, projects, sections, labels, notes };
}

/**
 * Folds the answers to a write into the snapshot: each answer in the order it
 * came, then every temporary id resolved. The one way a write lands, whether
 * it went out at once or waited in the offline queue.
 */
export function applyWrite(
  snapshot: Snapshot,
  responses: SyncResponse[],
  mapping: Record<string, string>,
): Snapshot {
  const merged = responses.reduce((current, response) => applySync(current, response), snapshot);
  return resolveTempIds(merged, mapping);
}
