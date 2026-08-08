import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .tsx for component tests. They opt into jsdom with a `@vitest-environment` docblock rather
    // than the environment being set here, so the several hundred node-environment tests are
    // unaffected by there being a few that need a DOM.
    include: ['src/**tests**/**/*.test.{ts,tsx}'],
    exclude: ['.claude/**', 'node_modules/**', 'release/**'],
  },
});
