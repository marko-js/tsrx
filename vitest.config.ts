import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/tsrx/tests/**/*.test.ts'],
		environment: 'node',
	},
});
