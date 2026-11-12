// The menu bar: every menu and its items, keyboard navigation, the shortcuts shown next to the items, the printer
// menu (also in the status bar) and the dialogs the menus open.
/* global PP */
import { test, expect } from './fixtures.js';
import { dialog, menu, menuItem, openApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const title = (page, name) => page.locator('#menubar').getByRole('menuitem', { name, exact: true });
const items = (page) => page.locator('.menu-pop .mi .mi-label');

test('each menu lists its commands with their shortcuts', async ({ page, consoleProblems }) => {
  const expected = {
    File: [
      'New project',
      'Open…',
      'Save',
      'Save as…',
      'Import SVG…',
      'Export SVG…',
      'Export G-code…',
      'Paper…',
      'Download pen mount…',
    ],
    Edit: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Duplicate', 'Delete', 'Select all'],
    View: ['Zoom in', 'Zoom out', 'Fit bed', 'Preview plot'],
    Printer: [
      'Bambu Lab X1 Carbon',
      'Bambu Lab X1 / X1E',
      'Bambu Lab P1S / P1P',
      'Bambu Lab A1',
      'Custom Board (Marlin)',
      'Printer settings…',
      'Calibrate…',
    ],
    Help: [
      'Getting started',
      'Calibration guide',
      'Safety',
      'Keyboard shortcuts',
      'DaVinci on GitHub',
      'About DaVinci',
    ],
  };
  for (const [name, list] of Object.entries(expected)) {
    await title(page, name).click();
    await expect(items(page)).toHaveText(list);
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu-pop')).toHaveCount(0);
  }
  await title(page, 'File').click();
  await expect(menuItem(page, 'Save')).toContainText('Ctrl+S');
  await expect(menuItem(page, 'Save as…')).toContainText('Ctrl+Shift+S');
  await expect(menuItem(page, 'Export G-code…')).toHaveAttribute('aria-keyshortcuts', 'Control+E');
  // Ctrl+N belongs to the browser: only the desktop app shows (and gets) it
  await expect(menuItem(page, 'New project').locator('.mi-keys')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(consoleProblems).toEqual([]);
});

test('menus work from the keyboard and switch on hover', async ({ page, consoleProblems }) => {
  const file = title(page, 'File');
  await file.focus();
  await page.keyboard.press('ArrowDown');
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await expect(menuItem(page, 'New project')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'Open…')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(menuItem(page, 'Download pen mount…')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(title(page, 'Edit')).toHaveAttribute('aria-expanded', 'true');
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-pop')).toHaveCount(0);
  await expect(title(page, 'Edit')).toBeFocused();

  // with a menu open, pointing at another title opens that one
  await file.click();
  await title(page, 'Help').hover();
  await expect(items(page).first()).toHaveText('Getting started');
  // clicking the open menu's title closes it
  await title(page, 'Help').click();
  await expect(page.locator('.menu-pop')).toHaveCount(0);

  // Enter on an item runs it
  await title(page, 'View').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(menuItem(page, 'Preview plot')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => PP.Preview.active)).toBe(true);
  await title(page, 'View').click();
  await expect(menuItem(page, 'Preview plot')).toHaveAttribute('aria-checked', 'true');
  await menuItem(page, 'Preview plot').click();
  await expect.poll(() => page.evaluate(() => PP.Preview.active)).toBe(false);
  expect(consoleProblems).toEqual([]);
});

test('the printer menu and the status bar switch printers', async ({ page, consoleProblems }) => {
  const chip = page.locator('#statusbar .st-printer');
  await menu(page, 'Printer', 'Bambu Lab A1');
  await expect.poll(() => page.evaluate(() => PP.App.profile().id)).toBe('bambu-a1');
  await expect(chip).toHaveText('Bambu Lab A1');
  await title(page, 'Printer').click();
  await expect(menuItem(page, 'Bambu Lab A1')).toHaveAttribute('aria-checked', 'true');
  await expect(menuItem(page, 'Bambu Lab X1 Carbon')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // the status bar chip opens the same list
  await chip.click();
  await menuItem(page, 'Bambu Lab X1 Carbon').click();
  await expect(chip).toHaveText('Bambu Lab X1 Carbon');
  expect(consoleProblems).toEqual([]);
});

test('menus open the dialogs; shortcuts work outside the menus', async ({ page, consoleProblems }) => {
  for (const [m, item, heading] of [
    ['Printer', 'Calibrate…', 'Calibration'],
    ['Help', 'Keyboard shortcuts', 'Help'],
    ['Help', 'About DaVinci', 'About DaVinci'],
    ['File', 'Export G-code…', 'Export G-code'],
  ]) {
    await menu(page, m, item);
    await expect(dialog(page, heading)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page, heading)).toBeHidden();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Control+,');
  await expect(dialog(page, 'Printer & plotter settings')).toBeVisible();
  await page.keyboard.press('Escape');

  await menu(page, 'File', 'Paper…');
  await expect(page.locator('.popover .paper-form')).toBeVisible();
  await page.keyboard.press('Escape');

  // Export SVG downloads the design; Import SVG opens a file picker
  const [svg] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+e')]);
  expect(svg.suggestedFilename()).toBe('Untitled_plot.svg');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+i')]);
  expect(chooser.isMultiple()).toBe(false);

  // Edit → Select all, then Delete
  await menu(page, 'Edit', 'Select all');
  await expect.poll(() => page.evaluate(() => PP.Store.selection.length)).toBe(4);
  await menu(page, 'Edit', 'Delete');
  await expect.poll(() => page.evaluate(() => PP.Store.project.objects.length)).toBe(0);
  expect(consoleProblems).toEqual([]);
});
