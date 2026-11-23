import { defineConfig } from 'vitest/config';

// Separate from the clone-ready runtime/artifact suite in vite.config.ts.
export default defineConfig({
  test: {
    include: ['tests/provenance/**/*.audit.ts'],
    environment: 'node',
    globalSetup: ['tests/provenance/setup.ts'],
  },
});
