import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * A page with the demo open, and a watch on the console: any error logged
 * while a journey runs fails it, whatever the journey was checking.
 */
export const test = base.extend<{ demo: Page }>({
  demo: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    // The demo account has been through the first run, so no tour stands in front.
    await page.addInitScript(() => {
      localStorage.setItem('onboarded', JSON.stringify(['demo-user']));
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore with demo data instead' }).click();
    await expect(rows(page).first()).toBeVisible();

    await use(page);
    expect(errors, 'errors in the console').toEqual([]);
  },
});

export { expect };

/** The task rows on the page in front. */
export const rows = (page: Page): Locator => page.locator('.screen.active [data-task-id]');

/** A task row by its title. */
export const row = (page: Page, title: string): Locator =>
  rows(page).filter({ has: page.locator('.ttitle', { hasText: title }) }).first();

/** The titles of the rows on the page in front, top to bottom. */
export const titles = (page: Page): Promise<string[]> =>
  page.locator('.screen.active [data-task-id] .ttitle').allInnerTexts();

/**
 * The titles of the one-off tasks on the page, top to bottom. A repeating
 * task ticked off rolls on to its next date rather than closing, so it has
 * nothing for an undo to reopen; journeys about undo leave those out. Which
 * demo tasks come first depends on the time of day.
 */
export const oneOffTitles = (page: Page): Promise<string[]> =>
  page.locator('.screen.active [data-task-id]')
    .filter({ hasNot: page.locator('.repeatdot') })
    .locator('.ttitle')
    .allInnerTexts();

/** Goes to a page by its address, the way a sidebar click does, without reloading. */
export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((to) => { window.location.hash = to; }, hash);
  await expect(page.locator('.screen.active')).toBeVisible();
}
