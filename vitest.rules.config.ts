import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/rules.test.ts',
      'tests/auth.integration.test.ts',
      'tests/membership.regression.test.ts',
      'tests/invitations.regression.test.ts',
      'tests/invitations.before.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
