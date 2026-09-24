import { expect, oneOffTitles, row, test } from './demo';

test('tick a task, then ⌘Z brings it back', async ({ demo: page }) => {
  const [title] = await oneOffTitles(page);
  await row(page, title).getByRole('checkbox', { name: 'Complete task' }).click();
  await expect(row(page, title)).toHaveCount(0);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, title)).toBeVisible();
});

test('select three tasks, E, then one ⌘Z restores all three (#80)', async ({ demo: page }) => {
  const picked = (await oneOffTitles(page)).slice(0, 3);
  for (const title of picked) {
    await row(page, title).click({ modifiers: ['ControlOrMeta'] });
  }
  await expect(page.getByRole('toolbar')).toContainText('3 selected');

  await page.keyboard.press('e');
  for (const title of picked) await expect(row(page, title)).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  for (const title of picked) await expect(row(page, title)).toBeVisible();
});

test('delete a task, then Undo within 8 s keeps it (#77)', async ({ demo: page }) => {
  const [title] = await oneOffTitles(page);
  const target = row(page, title);
  await target.hover();
  await target.getByRole('button', { name: 'More actions' }).click();
  await page.locator('.rowmenu').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, title)).toHaveCount(0);

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, title)).toBeVisible();
  // Past the 8 seconds the deletion would have been sent: still there.
  await page.waitForTimeout(8_500);
  await expect(row(page, title)).toBeVisible();
});

