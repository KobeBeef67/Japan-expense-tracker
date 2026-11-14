import { describe, it, expect, vi } from 'vitest';
import { pastedImages, readClipboardImages } from './receipt-clipboard';

describe('Receipt image paste', () => {
  const png = new File(['synthetic'], 'image.png', { type: 'image/png' });
  const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => png };
  it('leaves text and HTML alone', () => {
    expect(pastedImages(null)).toEqual([]);
    expect(
      pastedImages({
        items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }],
        files: [],
      }),
    ).toEqual([]);
  });
  it('adds an image once when both clipboard representations expose it', () => {
    expect(pastedImages({ items: [imageItem], files: [png] })).toEqual([png]);
  });
  it('supports the files-only fallback', () => {
    expect(pastedImages({ items: [], files: [png] })).toEqual([png]);
  });
  it('ignores missing item files and non-image files', () => {
    expect(
      pastedImages({
        items: [{ ...imageItem, getAsFile: () => null }],
        files: [new File(['text'], 'note.txt', { type: 'text/plain' })],
      }),
    ).toEqual([]);
  });
  it('uses one PNG representation instead of importing PNG/JPEG/HTML duplicates', async () => {
    const getType = vi.fn(async () => png);
    expect(
      await readClipboardImages([{ types: ['text/html', 'image/jpeg', 'image/png'], getType }]),
    ).toEqual([png]);
    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png');
  });
  it('does not read text-only clipboard items', async () => {
    const getType = vi.fn();
    expect(await readClipboardImages([{ types: ['text/html', 'text/plain'], getType }])).toEqual(
      [],
    );
    expect(getType).not.toHaveBeenCalled();
  });
  it('reports unsupported image formats and propagates read failures', async () => {
    await expect(
      readClipboardImages([{ types: ['image/svg+xml'], getType: vi.fn() }]),
    ).rejects.toThrow('unsupported');
    await expect(
      readClipboardImages([
        {
          types: ['image/png'],
          getType: async () => {
            throw new Error('denied');
          },
        },
      ]),
    ).rejects.toThrow('denied');
  });
});
