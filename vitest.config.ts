import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/finance.test.ts',
      'tests/auth.test.ts',
      'tests/config.test.ts',
      'tests/i18n.test.ts',
    ],
    environment: 'node',
  },
});
