export type ThemePreference = 'light' | 'dark';

/** Missing preferences and the retired System option open in light mode. */
export function themePreference(value: unknown): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}
export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
}
