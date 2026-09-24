import { ApiError, request } from './client';
import type { SyncResponse } from './sync';

/**
 * Writes to Todoist.
 *
 * Every change the app makes is expressed as a sync command and sent through
 * this queue. Commands carry a uuid so Todoist can discard a duplicate if a
 * retry goes through twice, which makes the queue safe to replay after the
 * network comes back.
 */

export interface Command {
  type: string;
  uuid: string;
  args: Record<string, unknown>;
  temp_id?: string;
}

export const newUuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function command(type: string, args: Record<string, unknown>, tempId?: string): Command {
  const cmd: Command = { type, uuid: newUuid(), args };
  if (tempId) {
    cmd.temp_id = tempId;
    cmd.args = { ...args, temp_id: undefined };
  }
  return cmd;
}

/** Todoist accepts up to 100 commands in one call. */
export const MAX_COMMANDS_PER_CALL = 100;
/**
 * And a request body of at most 1 MiB. A hundred ordinary commands never come
 * near it, but a batch built from long descriptions — restoring a deleted
 * branch, writing the settings — could, so a request is also cut by size.
 */
const MAX_BODY_BYTES = 900_000;

export interface CommandResult {
  /** Todoist's answers, one per request, in the order they were sent. */
  responses: SyncResponse[];
  /** Commands Todoist received and refused, with the reason it gave. */
  failures: Array<{ uuid: string; error: string }>;
  /** Every temporary id Todoist resolved, across all the requests. */
  mapping: Record<string, string>;
  /** The uuids of the commands Todoist received, accepted or refused. */
  delivered: string[];
  /**
   * Commands that never left because the network failed part-way, rewritten
   * with the ids resolved before it did. They belong back in the queue.
   */
  undelivered: Command[];
  /** Why the undelivered ones did not go. */
  error?: unknown;
}

/** Replaces every temporary id that Todoist has resolved, wherever it sits in a command's arguments. */
function resolveIds(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value === 'string') return mapping[value] ?? value;
  if (Array.isArray(value)) return value.map((entry) => resolveIds(entry, mapping));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [mapping[key] ?? key, resolveIds(entry, mapping)]),
    );
  }
  return value;
}

/** Cuts a list of commands into requests Todoist will accept, keeping their order. */
function chunk(commands: Command[]): Command[][] {
  const chunks: Command[][] = [];
  let current: Command[] = [];
  let bytes = 0;
  for (const cmd of commands) {
    const size = new TextEncoder().encode(JSON.stringify(cmd)).length;
    if (current.length > 0
      && (current.length >= MAX_COMMANDS_PER_CALL || bytes + size > MAX_BODY_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(cmd);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Sends every command, as many requests as it takes.
 *
 * It used to send the first hundred and say nothing about the rest, which the
 * callers then took off the queue as if they had gone. Requests go one after
 * the other, in order, each carrying the sync token the previous one returned
 * and the ids it resolved, because a later command can name something an
 * earlier one created.
 *
 * A request Todoist refuses outright is a refusal of each command in it, and
 * the next request still goes. A request the network loses stops the run: if
 * nothing had gone yet the error is thrown as before, and otherwise what went
 * is returned with what did not, for the caller to queue again.
 */
export async function sendCommands(
  syncToken: string,
  commands: Command[],
): Promise<CommandResult> {
  if (commands.length === 0) {
    throw new Error('sendCommands called with no commands');
  }

  const result: CommandResult = {
    responses: [], failures: [], mapping: {}, delivered: [], undelivered: [],
  };
  let token = syncToken;
  const chunks = chunk(commands);

  for (let at = 0; at < chunks.length; at += 1) {
    const batch = chunks[at].map((cmd) =>
      at === 0 ? cmd : { ...cmd, args: resolveIds(cmd.args, result.mapping) as Command['args'] });

    try {
      const response = await request<SyncResponse>('/sync', {
        method: 'POST',
        form: {
          sync_token: token,
          resource_types: JSON.stringify(['items', 'projects', 'sections', 'labels', 'notes', 'project_notes']),
          commands: JSON.stringify(batch),
        },
      });
      result.responses.push(response);
      Object.assign(result.mapping, response.temp_id_mapping ?? {});
      for (const [uuid, status] of Object.entries(response.sync_status ?? {})) {
        if (status !== 'ok') result.failures.push({ uuid, error: status.error });
      }
      token = response.sync_token ?? token;
    } catch (error) {
      if (error instanceof ApiError && error.isRefusal) {
        for (const cmd of batch) result.failures.push({ uuid: cmd.uuid, error: error.detail });
      } else {
        if (at === 0) throw error;
        result.undelivered = chunks.slice(at).flat()
          .map((cmd) => ({ ...cmd, args: resolveIds(cmd.args, result.mapping) as Command['args'] }));
        result.error = error;
        return result;
      }
    }
    result.delivered.push(...batch.map((cmd) => cmd.uuid));
  }

  return result;
}

/* ---------- The commands the product actually issues ---------- */

export const updateItem = (id: string, args: Record<string, unknown>): Command =>
  command('item_update', { id, ...args });

export const addItem = (args: Record<string, unknown>, tempId: string): Command => {
  const cmd: Command = { type: 'item_add', uuid: newUuid(), args, temp_id: tempId };
  return cmd;
};

export const completeItem = (id: string): Command => command('item_complete', { id });
export const uncompleteItem = (id: string): Command => command('item_uncomplete', { id });
export const deleteItem = (id: string): Command => command('item_delete', { id });

export const moveItem = (
  id: string,
  target: { project_id?: string; section_id?: string | null; parent_id?: string | null },
): Command => command('item_move', { id, ...target });

export const reorderItems = (items: Array<{ id: string; child_order: number }>): Command =>
  command('item_reorder', { items });

/**
 * The order of tasks in a list made of several projects.
 *
 * `child_order` is counted inside one project, so it has nothing to say about
 * a week drawn from five of them. `day_order` is the number Todoist keeps for
 * exactly that list, and its own Today view reads it.
 */
export const updateDayOrders = (orders: Record<string, number>): Command =>
  command('item_update_day_orders', { ids_to_orders: orders });

export const updateProject = (id: string, args: Record<string, unknown>): Command =>
  command('project_update', { id, ...args });
