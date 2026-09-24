import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTemporaryId, projectEmail, todoistTaskUrl } from './links';
import { request } from './client';

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  request: vi.fn(),
}));
const sent = vi.mocked(request);
beforeEach(() => { sent.mockReset(); });

describe('links', () => {
  it('builds a task address in Todoist', () => {
    expect(todoistTaskUrl('6X7rM8997g3RQmvh')).toBe('https://app.todoist.com/app/task/6X7rM8997g3RQmvh');
  });

  it("tells a made-up id from Todoist's", () => {
    expect(isTemporaryId('0b9f6c1e-3a1d-4c2e-9f3b-8d7a6e5c4b3a')).toBe(true);
    expect(isTemporaryId('6X7rM8997g3RQmvh')).toBe(false);
  });

  it("asks Todoist for a project's address once, then remembers it", async () => {
    sent.mockResolvedValue({ email: 'add.task.abc@todoist.net' } as never);
    expect(await projectEmail('p1')).toBe('add.task.abc@todoist.net');
    expect(await projectEmail('p1')).toBe('add.task.abc@todoist.net');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith('/emails', {
      method: 'PUT', json: { obj_type: 'project', obj_id: 'p1' },
    });
  });
});
