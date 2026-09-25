# Google Health Sync — Obsidian plugin

Obsidian plugin (TypeScript, bundled with esbuild) that syncs Google Health data into a vault.
Desktop-only for now (`isDesktopOnly: true`) because Google OAuth uses a local redirect.

## Commands

- `npm run check`: typecheck, lint, format check, tests. Run before committing.
- `npm run build`: typecheck + production bundle to `main.js`.
- `npm run lint:fix` / `npm run format`: auto-fix lint and formatting.
- `npm test`: Vitest unit tests in `tests/`.

## Conventions

- Source lives in `src/`; `src/main.ts` is the entry point. Keep `main.ts` thin: the plugin
  lifecycle, commands and wiring. Put API clients, data mapping and note rendering in their
  own modules so they can be unit-tested without Obsidian.
- The `obsidian` package is types only. Tests alias it to `tests/__mocks__/obsidian.ts`;
  add stubs there when tested code needs more of the API at runtime.
- Lint rules come from `eslint-plugin-obsidianmd` and mirror the community plugin review
  (sentence case UI text, no `innerHTML`, use `requestUrl` rather than `fetch`, use
  `this.app` rather than the global `app`, and so on). Fix warnings; don't disable rules without a
  described reason.
- Use `requestUrl` from `obsidian` for HTTP (it avoids CORS issues).
- Register intervals and events with `this.registerInterval` / `this.registerEvent` so they
  are cleaned up on unload.
- Formatting: Prettier with tabs, width 100. YAML uses 2 spaces.
- Never commit `main.js`, `data.json` (plugin data, may hold OAuth tokens) or secrets.

## Versioning

`npm version <patch|minor|major>` bumps `package.json`, `manifest.json` and `versions.json`
together. Tags have no `v` prefix; pushing a tag triggers the draft-release workflow.
