import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/finance.test.ts', 'tests/auth.test.ts', 'tests/config.test.ts'],
    environment: 'node',
  },
});
