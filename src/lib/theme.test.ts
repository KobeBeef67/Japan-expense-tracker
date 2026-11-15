import { describe, it, expect } from 'vitest';
import { themePreference } from './theme';

describe('Theme preference', () => {
  it('defaults missing, unknown, and retired System preferences to light', () => {
    for (const value of [undefined, null, {}, 1, 'unknown', 'system'])
      expect(themePreference(value)).toBe('light');
  });
  it('keeps explicit light and dark choices', () => {
    expect(themePreference('light')).toBe('light');
    expect(themePreference('dark')).toBe('dark');
  });
});
