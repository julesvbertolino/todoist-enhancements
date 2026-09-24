import { request } from './client';

/**
 * Links into Todoist, and putting them on the clipboard.
 *
 * "Open in Todoist" and "Copy link" build the same address; one function keeps
 * the two from drifting apart.
 */

/** A task's page in Todoist's web app. */
export const todoistTaskUrl = (id: string): string => `https://app.todoist.com/app/task/${id}`;

/**
 * An id the app made up while Todoist had not answered yet (see `newUuid`).
 * Todoist's own ids have no dashes, and a made-up one has no page to link to.
 */
export const isTemporaryId = (id: string): boolean => id.includes('-');

/** Copies text, and says whether it worked: the clipboard can be refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies text that is still on its way, such as an answer from Todoist.
 *
 * Safari only lets a page write to the clipboard during the click that asked
 * for it, and a network request outlasts the click. Handing the clipboard the
 * pending text at once keeps the write inside the click; where that form is
 * missing, the text is awaited and copied the ordinary way.
 */
export async function copyPending(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      /* fall through: some browsers refuse a pending item */
    }
  }
  try {
    return await copyText(await text);
  } catch {
    return false;
  }
}

const projectEmails = new Map<string, string>();

/**
 * The address that turns an email into a task in this project. Todoist makes
 * it on the first request and gives the same one after that; it is kept here
 * for the session so a second copy needs no round trip.
 */
export async function projectEmail(projectId: string): Promise<string> {
  const known = projectEmails.get(projectId);
  if (known) return known;
  const { email } = await request<{ email: string }>('/emails', {
    method: 'PUT',
    json: { obj_type: 'project', obj_id: projectId },
  });
  projectEmails.set(projectId, email);
  return email;
}
