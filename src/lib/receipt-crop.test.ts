import { describe, it, expect } from 'vitest';
import { cropPixels } from './receipt-images';

describe('Photo crop coordinates', () => {
  it('uses source pixels rather than display pixels', () => {
    expect(cropPixels({ left: 0.25, top: 0.1, width: 0.5, height: 0.8 }, 1920, 1080)).toEqual({
      left: 480,
      top: 108,
      width: 960,
      height: 864,
    });
  });
  it('rounds outward and clamps the far edge to the source', () => {
    expect(cropPixels({ left: 0.101, top: 0.101, width: 0.899, height: 0.899 }, 100, 100)).toEqual({
      left: 10,
      top: 10,
      width: 90,
      height: 90,
    });
  });
  it.each([
    { left: -0.1, top: 0, width: 0.5, height: 0.5 },
    { left: 0.6, top: 0, width: 0.5, height: 0.5 },
    { left: 0, top: 0, width: 0, height: 1 },
    { left: 0, top: 0, width: 1, height: NaN },
  ])('rejects invalid bounds: %j', (rect) => {
    expect(() => cropPixels(rect, 1920, 1080)).toThrow('inside');
  });
  it('rejects selections too small to read', () => {
    expect(() => cropPixels({ left: 0, top: 0, width: 0.001, height: 1 }, 1920, 1080)).toThrow(
      'larger',
    );
  });
});
