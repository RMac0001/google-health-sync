# Google Health Sync

An [Obsidian](https://obsidian.md) plugin that syncs Google Health data into your vault.

> **Status:** early development. The plugin loads, has a settings tab and a "Sync now"
> command, but does not fetch any data yet.

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev      # watch mode: rebuilds main.js on change
npm run build    # typecheck + production build
npm run check    # typecheck, lint, format check, tests
```

### Testing in a vault

Link (or copy) the repo into a test vault's plugin folder, then enable the plugin under
**Settings → Community plugins**:

```bash
# macOS / Linux
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/google-health-sync
```

```powershell
# Windows (run as admin, or with Developer Mode enabled)
New-Item -ItemType SymbolicLink -Path "C:\path\to\vault\.obsidian\plugins\google-health-sync" -Target (Get-Location)
```

Use a dedicated test vault, not your main one. The
[Hot-Reload](https://github.com/pjeby/hot-reload) plugin reloads the plugin automatically
when `main.js` changes.

### Project layout

| Path                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `src/main.ts`        | Plugin entry point (`onload`, commands, settings wiring)       |
| `src/settings.ts`    | Settings interface, defaults and settings tab                  |
| `tests/`             | Vitest unit tests; `tests/__mocks__/obsidian.ts` stubs the API |
| `manifest.json`      | Plugin metadata read by Obsidian                               |
| `versions.json`      | Plugin version → minimum Obsidian version map                  |
| `esbuild.config.mjs` | Bundles `src/` into `main.js`                                  |

## Releasing

1. `npm version patch` (or `minor` / `major`). This updates `package.json`,
   `manifest.json` and `versions.json`, commits, and creates a tag without a `v` prefix.
2. `git push --follow-tags`
3. The **Release** workflow builds the plugin and creates a draft GitHub release with
   `main.js`, `manifest.json` and `styles.css`. Review it and publish.

## License

[GPL-3.0](LICENSE)
