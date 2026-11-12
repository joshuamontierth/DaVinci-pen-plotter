// Project files: Save writes a gzipped .davinci that Open reads back; anything else is refused.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test, expect } from './fixtures.js';
import { openApp } from './helpers.js';

test('saves a .davinci project and opens it again', async ({ page, consoleProblems }) => {
  await openApp(page);
  const name = page.locator('.project-name');
  await name.fill('Round trip');
  await name.press('Enter');

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save project (Ctrl+S)' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('Round_trip.davinci');
  const bytes = readFileSync(await dl.path());
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const data = JSON.parse(gunzipSync(bytes).toString());
  expect(data.name).toBe('Round trip');

  const open = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open project (Ctrl+O)' }).click();
    await (await chooser).setFiles(file);
  };
  await name.fill('Something else');
  await name.press('Enter');
  await open({ name: 'Round_trip.davinci', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(name).toHaveValue('Round trip');
  const count = await page.evaluate(() => window.PP.Store.project.objects.length);
  expect(count).toBe(data.objects.length);

  // plain JSON is not a project file
  await open({
    name: 'plain.davinci',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, name: 'Plain' })),
  });
  await expect(page.locator('.toast', { hasText: 'This is not a DaVinci project file.' })).toBeVisible();
  await expect(name).toHaveValue('Round trip');
  expect(consoleProblems).toEqual([]);
});
