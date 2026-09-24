import { expect, go, test } from './demo';

/* Every page the sidebar leads to, opened in turn; the fixture fails the test
   on any console error along the way. */
const PAGES = [
  '#/inbox', '#/week', '#/today', '#/upcoming', '#/someday', '#/review', '#/labels',
  '#/insights', '#/settings', '#/project/personal', '#/project/home', '#/project/site',
  '#/project/client-a', '#/label/quick',
];

test('every page opens without an error', async ({ demo: page }) => {
  for (const hash of PAGES) {
    await go(page, hash);
    await expect(page.locator('.screen.active'), hash).not.toBeEmpty();
  }
});
