import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test the working source only. Ignored checkout/export directories can contain copies.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/test-results/**', '**/src-tauri/target/**'],
  },
});
