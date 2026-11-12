#!/usr/bin/env node
/**
 * Renders the app icon (src/assets/davinci.svg) into the PNG sizes and the Windows .ico the installers use
 * (installer/icons/). Run it after changing the SVG: npm run icons. Chromium (Playwright) does the rendering,
 * so the PNGs match what the browser shows.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SVG = join(ROOT, 'src', 'assets', 'davinci.svg');
const OUT = join(ROOT, 'installer', 'icons');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** A .ico with one PNG-compressed image per size (Windows Vista and later read these). */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

const svg = readFileSync(SVG);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const url = 'data:image/svg+xml;base64,' + svg.toString('base64');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const pngs = new Map();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html style="background:transparent"><body style="margin:0"><img src="${url}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    const png = await page.screenshot({ omitBackground: true });
    pngs.set(size, png);
    writeFileSync(join(OUT, `${size}x${size}.png`), png);
  }
  writeFileSync(join(OUT, 'davinci.ico'), ico(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
  console.log(`icons: ${SIZES.length} PNG sizes and davinci.ico in ${OUT}`);
} finally {
  await browser.close();
}
