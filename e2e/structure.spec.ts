import { expect, go, row, test, titles } from './demo';

test('create a section, then rename it (#79)', async ({ demo: page }) => {
  await go(page, '#/project/home');
  await page.locator('.screen.active').getByRole('button', { name: 'Add section' }).click();
  const field = page.locator('.screen.active').getByRole('textbox', { name: 'Section name' }).last();
  await expect(field).toBeFocused();
  await field.fill('Garage');
  await field.press('Enter');
  // Held by its section id, which stays put while the name changes.
  const id = await field.getAttribute('data-section-name');
  const name = page.locator(`.screen.active input[data-section-name="${id}"]`);
  await expect(name).toHaveValue('Garage');

  await name.fill('Garage and tools');
  await name.press('Enter');
  await expect(name).toHaveValue('Garage and tools');
  await expect(name).not.toBeFocused();
});

test('drag a selection onto a project moves every task in it (#81)', async ({ demo: page }) => {
  const picked = (await titles(page)).slice(0, 2);
  for (const title of picked) await row(page, title).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('toolbar')).toContainText('2 selected');

  const handle = row(page, picked[1]).locator('.drag');
  await row(page, picked[1]).hover();
  const from = (await handle.boundingBox())!;
  const target = page.locator('.sidebar').getByRole('button', { name: '# Home', exact: true }).first();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  /* The sidebar scrolls itself while something is dragged near its edges, so
     the project is measured again on the way rather than once at the start. */
  for (let pass = 0; pass < 4; pass += 1) {
    const to = (await target.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
  }
  await page.mouse.up();

  await go(page, '#/project/home');
  for (const title of picked) await expect(row(page, title)).toBeVisible();
});

test('a long list scrolls all the way to its last task (#67)', async ({ demo: page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await go(page, '#/someday');
  const all = await titles(page);
  expect(all.length).toBeGreaterThan(3);
  const last = row(page, all[all.length - 1]);
  await page.locator('.screen.active').evaluate((screen) => { screen.scrollTop = screen.scrollHeight; });
  await expect(last).toBeInViewport();
});
