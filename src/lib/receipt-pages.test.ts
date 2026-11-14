import { describe, it, expect, vi } from 'vitest';
import { extractReceipt } from './receipt-parser';
import { mergeReceiptPages } from './receipt-pages';
import { focusPoint, adjustableRange, applyCameraSetting } from './camera-controls';

describe('Multiple photos of one receipt', () => {
  it('combines a date-only photo and a total-only photo', () => {
    const result = mergeReceiptPages([extractReceipt('2026-11-14'), extractReceipt('TOTAL 1280')]);
    expect(result.date).toBe('2026-11-14');
    expect(result.amount).toBe(1280);
    expect(result.warnings).toEqual([]);
    expect(result.candidates[0].context).toContain('Photo 2');
  });
  it('does not add repeated totals or count them as conflicts', () => {
    const result = mergeReceiptPages([extractReceipt('TOTAL 1280'), extractReceipt('TOTAL 1280')]);
    expect(result.amount).toBe(1280);
  });
  it('leaves conflicting dates and totals unresolved', () => {
    const result = mergeReceiptPages([
      extractReceipt('2026-11-14\nTOTAL 1280'),
      extractReceipt('2026-11-15\nTOTAL 700'),
    ]);
    expect(result.date).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.dateCandidates).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('conflicting');
  });
  it('fills one unlabelled amount even when the date comes from another photo', () => {
    expect(mergeReceiptPages([extractReceipt('2026-11-14'), extractReceipt('¥700')]).amount).toBe(
      700,
    );
  });
  it('fills repeated copies of the same unlabelled amount without adding them', () => {
    expect(mergeReceiptPages([extractReceipt('¥770'), extractReceipt('¥770')]).amount).toBe(770);
  });
  it('leaves different unlabelled candidates across photos unresolved', () => {
    expect(mergeReceiptPages([extractReceipt('¥770'), extractReceipt('¥700')]).amount).toBeNull();
  });
  it('keeps a unique labelled total ahead of unlabelled item prices', () => {
    expect(
      mergeReceiptPages([extractReceipt('TOTAL 770'), extractReceipt('item ¥500')]).amount,
    ).toBe(770);
  });
  it('retains a recognised zero as a candidate value', () => {
    expect(mergeReceiptPages([extractReceipt('¥0')]).amount).toBe(0);
  });
});

describe('Camera controls without hardware', () => {
  it('maps focus points to the video excluding letterboxing', () => {
    expect(focusPoint(10, 50, 200, 100, 100, 100)).toBeNull();
    expect(focusPoint(100, 50, 200, 100, 100, 100)).toEqual({ x: 0.5, y: 0.5 });
    expect(focusPoint(150, 100, 200, 100, 100, 100)).toEqual({ x: 1, y: 1 });
  });
  it('hides absent and fixed ranges', () => {
    expect(adjustableRange(undefined)).toBe(false);
    expect(adjustableRange({ min: 1, max: 1 })).toBe(false);
    expect(adjustableRange({ min: 0, max: 10 })).toBe(true);
  });
  it('does not claim an ignored optional constraint worked', async () => {
    const track = {
      applyConstraints: vi.fn(async () => {}),
      getSettings: () => ({ focusMode: 'continuous' }),
    } as unknown as MediaStreamTrack;
    expect(await applyCameraSetting(track, { focusMode: 'manual' })).toBe(false);
    expect(await applyCameraSetting(track, { focusMode: 'continuous' })).toBe(true);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'manual' }] });
  });
  it('retains resolution and manual mode when adjusting focus distance', async () => {
    const applyConstraints = vi.fn(async () => {});
    const track = {
      applyConstraints,
      getConstraints: () => ({ width: { ideal: 2560 }, advanced: [{ focusMode: 'manual' }] }),
      getSettings: () => ({ focusMode: 'manual', focusDistance: 2 }),
    } as unknown as MediaStreamTrack;
    expect(await applyCameraSetting(track, { focusDistance: 2 })).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 2560 },
      advanced: [{ focusMode: 'manual', focusDistance: 2 }],
    });
  });
  it('surfaces camera rejection', async () => {
    const track = {
      applyConstraints: async () => {
        throw new Error('not supported');
      },
    } as unknown as MediaStreamTrack;
    await expect(applyCameraSetting(track, { focusMode: 'manual' })).rejects.toThrow(
      'not supported',
    );
  });
});
