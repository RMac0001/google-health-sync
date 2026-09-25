import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default tseslint.config(
	globalIgnores([
		"node_modules",
		"main.js",
		"coverage",
		"esbuild.config.mjs",
		"eslint.config.mjs",
		"version-bump.mjs",
		"vitest.config.ts",
		"versions.json",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: [
						...DEFAULT_BRANDS,
						"Google Health Sync",
						"Google Health",
						"Google Cloud",
					],
				},
			],
		},
	},
);
