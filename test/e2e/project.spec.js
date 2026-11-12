// Project files: File → Save writes a gzipped .davinci that File → Open reads back; anything else is refused. Save
// writes to the file the project came from (File System Access in Chromium), Save as asks again.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test, expect } from './fixtures.js';
import { menu, openApp } from './helpers.js';

test('downloads a .davinci project and opens it again (browsers without file handles)', async ({
  page,
  consoleProblems,
}) => {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });
  await openApp(page);
  const name = page.getByRole('textbox', { name: 'Project name' });
  await name.fill('Round trip');
  await name.press('Enter');
  await expect(page).toHaveTitle('Round trip — DaVinci');

  const save = async (action) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
    return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) };
  };
  const first = await save(() => menu(page, 'File', 'Save'));
  expect(first.name).toBe('Round_trip.davinci');
  expect([first.bytes[0], first.bytes[1]]).toEqual([0x1f, 0x8b]);
  const data = JSON.parse(gunzipSync(first.bytes).toString());
  expect(data).toMatchObject({ app: 'DaVinci', name: 'Round trip' });

  // Ctrl+S saves too, even while typing in a field
  await name.click();
  expect((await save(() => page.keyboard.press('Control+s'))).name).toBe('Round_trip.davinci');

  const open = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+o');
    await (await chooser).setFiles(file);
  };
  await name.fill('Something else');
  await name.press('Enter');
  await open({ name: 'Round_trip.davinci', mimeType: 'application/octet-stream', buffer: first.bytes });
  await expect(name).toHaveValue('Round trip');
  expect(await page.evaluate(() => window.PP.Store.project.objects.length)).toBe(data.objects.length);

  // Save as asks for a name, and the project takes it
  const renamed = await save(async () => {
    await page.keyboard.press('Control+Shift+s');
    const ask = page.getByRole('dialog').filter({ hasText: 'Save as' });
    await ask.getByRole('textbox', { name: 'File name' }).fill('Second copy');
    await ask.getByRole('button', { name: 'Save' }).click();
  });
  expect(renamed.name).toBe('Second_copy.davinci');
  await expect(name).toHaveValue('Second copy');

  // plain JSON is not a project file
  await open({
    name: 'plain.davinci',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, name: 'Plain' })),
  });
  await expect(page.locator('.toast', { hasText: 'This is not a DaVinci project file.' })).toBeVisible();
  await expect(name).toHaveValue('Second copy');
  expect(consoleProblems).toEqual([]);
});

test('Save writes back to the chosen file; Save as picks a new one', async ({ page, consoleProblems }) => {
  // a stand-in for Chromium's file pickers: each handle records what was written to it
  await page.addInitScript(() => {
    const handle = (name) => ({
      name,
      writes: [],
      async createWritable() {
        const h = this;
        return {
          async write(d) {
            h.writes.push(new Uint8Array(d).length);
          },
          async close() {},
        };
      },
    });
    window.pickers = [];
    window.showSaveFilePicker = async (opts) => {
      const h = handle(window.pickers.length ? 'Other name.davinci' : opts.suggestedName);
      window.pickers.push(h);
      return h;
    };
  });
  await openApp(page);
  const pickers = () => page.evaluate(() => window.pickers.map((h) => ({ name: h.name, writes: h.writes.length })));

  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Project saved as Untitled_plot.davinci' })).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(pickers).toEqual([{ name: 'Untitled_plot.davinci', writes: 2 }]);

  // Save as: a new file, and its name becomes the project's
  await menu(page, 'File', 'Save as…');
  await expect.poll(pickers).toEqual([
    { name: 'Untitled_plot.davinci', writes: 2 },
    { name: 'Other name.davinci', writes: 1 },
  ]);
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Other name');

  // a new project forgets the file
  await page.evaluate(() => window.PP.Store.reset());
  await menu(page, 'File', 'New project');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await pickers()).length).toBe(3);
  expect(consoleProblems).toEqual([]);
});
