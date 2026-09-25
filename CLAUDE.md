# Google Health Sync — Obsidian plugin

Obsidian plugin (TypeScript, bundled with esbuild). Once a day it pushes a food log's
`cal_total` to Google Health as a "Daily intake" nutrition entry and pulls total calories
burned back into the same food log. Desktop-only (`isDesktopOnly: true`); OAuth uses a
copy-paste authorization code. `README.md` has the user-facing behaviour and `STATUS.md`
the implementation notes and API details still to verify live.

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

## Architecture

- `src/google/` is a generic Google Health client (`listDataPoints`, `createDataPoint`,
  `batchDeleteDataPoints`, `dailyRollUp`) plus OAuth. Data-type specifics live in
  `src/jobs/`, so a new data type (steps, workouts) is a new job, not a client change.
- Jobs and `runSync` take a `FoodLogStore` and an `HttpClient`, so tests use in-memory notes
  and `tests/helpers.ts`'s `FakeGoogle` instead of Obsidian or the network.
- Errors: `TransientError` (network/429/5xx) and `AuthError` stop a run; `ApiError` becomes a
  per-day "error" result.

## Hard rules (from the spec)

- Never create notes; only write to food logs that exist. Don't touch daily notes.
- Never write or push zero in place of missing data; skip the day instead.
- No hardcoded paths, property names or times; they belong in settings.
- Calorie values are whole integers (`Math.round`).
- Parse bare `YYYY-MM-DD` with `parseLocalDate()`, never `new Date("YYYY-MM-DD")`.
- Never log tokens or the client secret.

## Versioning

`npm version <patch|minor|major>` bumps `package.json`, `manifest.json` and `versions.json`
together. Tags have no `v` prefix; pushing a tag triggers the draft-release workflow.
