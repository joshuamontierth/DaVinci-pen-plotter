// .davinci project files: the project JSON, gzipped; anything else is refused.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

describe('.davinci files', () => {
  const { U, Store } = window.PP;
  it('are the project JSON gzipped', async () => {
    const text = JSON.stringify({ name: 'Test', objects: [1, 2, 3] });
    const gz = await U.gzip(text);
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b]);
    expect(gunzipSync(gz).toString()).toBe(text);
    expect(await U.gunzipText(gz.buffer)).toBe(text);
    await expect(U.gunzipText(new TextEncoder().encode(text).buffer)).rejects.toThrow();
  });

  it('round-trip through serialize and load, and other JSON is refused', () => {
    const data = JSON.parse(JSON.stringify(Store.serialize()));
    expect(data.app).toBe('DaVinci');
    expect(() => Store.load(data, { history: false })).not.toThrow();
    expect(() => Store.load({ ...data, app: 'Something else' }, { history: false })).toThrow(/not a DaVinci project/);
  });
});
