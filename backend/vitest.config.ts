import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The scheduling/limiting logic under test is pure, so no DB or Redis is
    // needed — these run standalone with `npm test`.
    setupFiles: ['tests/setup.ts'],
  },
});
