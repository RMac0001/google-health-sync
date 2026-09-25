import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			// The real "obsidian" package only ships type definitions; tests use a small stub.
			obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
