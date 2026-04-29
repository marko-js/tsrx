import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/*/tests/**/*.test.ts'],
		environment: 'node',
		// Integration tests build and serve real apps; run files serially so
		// they don't race over the same dist directories or port numbers.
		fileParallelism: false,
	},
});
