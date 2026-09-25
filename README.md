# Google Health Sync

An [Obsidian](https://obsidian.md) plugin that puts daily calories eaten and daily calories
burned side by side, in both Google Health and your vault. Desktop only.

Once a day (at a time you choose, default 03:00) it processes the previous day and does two
independent jobs:

1. **Push intake:** reads `cal_total` from that day's food log and sends it to Google Health
   as one nutrition entry named "Daily intake".
2. **Pull burn:** fetches that day's total calories burned (resting + active) from Google
   Health and writes it to `calories_burned` in the same food log.

The plugin never creates notes, never writes or pushes a zero in place of missing data, and
never touches daily notes. Each run also re-checks the last few days (look-back), so late
food-log edits and late watch syncs are picked up.

## One-time Google Cloud setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable
   the **Google Health API**.
2. Create an **OAuth 2.0 Client ID** of type **Web application**, with authorized redirect
   URI `https://www.google.com`. Copy the Client ID and Client Secret.
3. On the **Audience** page, set user type to **External** and add your Google account as a
   test user.
4. On the **Data Access** page, add these three scopes:
    - `https://www.googleapis.com/auth/googlehealth.nutrition.writeonly`: create and delete the
      Daily intake entries
    - `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`: find existing Daily
      intake entries (duplicate protection)
    - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`: read total
      calories burned
5. **Publish the app** (Publishing status → **In production**). Don't submit it for
   verification. In Testing mode Google's refresh tokens expire after 7 days, which would
   break the daily sync every week; in production they don't expire unless revoked or unused
   for months. An unverified app is capped at 100 users, which doesn't matter here. Expect an
   "unverified app" warning once when you sign in; click through it.

## Installing

Install with [BRAT](https://github.com/TfTHacker/obsidian42-brat), which installs the plugin
from this repo's GitHub releases and keeps it updated:

1. In Obsidian, **Settings → Community plugins → Browse**, search for **BRAT**, install and
   enable it.
2. Run the command **BRAT: Add a beta plugin for testing** (or use BRAT's settings →
   **Add beta plugin**) and enter `RMac0001/google-health-sync`.
3. Enable **Google Health Sync** under **Settings → Community plugins**.

BRAT checks for new releases when Obsidian starts; run **BRAT: Check for updates to all beta
plugins** to update immediately. If the repo is private, BRAT also needs a GitHub personal
access token with read access to it (BRAT settings → **Personal access token**).

## Connecting

1. In **Settings → Google Health Sync**, enter the Client ID and Client Secret.
2. Click **Connect**. Your browser opens Google's consent page.
3. After you allow access, Google sends you to `https://www.google.com/?code=…`. Copy the
   whole address from the address bar (or just the code) and paste it into the prompt in
   Obsidian.
4. Settings shows **Connected** and whether all three permissions were granted. If one is
   missing, the job that needs it is skipped.
5. Turn on **Enable daily sync**.

The client secret and refresh token are kept in Obsidian's secret storage, not in the vault.

## Settings

| Setting              | Default                                                          | Notes                                                                           |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Enable daily sync    | Off                                                              | Can only be turned on once connected.                                           |
| Sync time            | `03:00`                                                          | 24-hour local time.                                                             |
| Look-back days       | `3`                                                              | Days each run re-checks, 1–14.                                                  |
| Food log path        | `Data/Food Logs/FL-{YYYY}/FL-{YYYY}-{MM}/FL-{YYYY}-{MM}-{DD}.md` | `{YYYY}`, `{MM}`, `{DD}` are replaced with the date.                            |
| Intake property      | `cal_total`                                                      | Read from the food log and pushed to Google Health.                             |
| Burn property        | `calories_burned`                                                | Written to the food log.                                                        |
| Carbs / Fat property | `carbs_total` / `fat_total`                                      | Only used if Google refuses an entry with calories alone (see STATUS.md).       |
| Entry name           | `Daily intake`                                                   | Name of the Google Health entry; entries with this name are replaced on change. |
| Client ID / secret   | (empty)                                                          | From Google Cloud.                                                              |

Every change is saved immediately; a short "settings saved" notice confirms it.

## Commands

- **Sync now:** runs the daily process immediately (ignores the sync time, same day window).
  Shows a summary such as `3 days: pushed 1, unchanged 2 · burn wrote 3`.
- **Sync a specific date:** asks for a `YYYY-MM-DD` date and runs both jobs for that day only.
  Doesn't affect the daily schedule.

## Scheduling

Obsidian has to be open for anything to run. The plugin checks once a minute, and once when
Obsidian starts, whether the sync time has passed and today's run hasn't happened yet. So if
the computer was asleep at 03:00, the sync runs as soon as Obsidian opens. Each run covers
yesterday plus the look-back window, and any days missed since the last successful run (up
to 14). After an error (network, rate limit, server) it retries no sooner than 15 minutes
later. If Google access is revoked, the status shows **Reconnect needed** and syncing stops
until you reconnect.

Per-day results are logged to the developer console (verbose level) with a
`[Google Health Sync]` prefix, and shown under **Status** in settings.

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

| Path                 | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `src/main.ts`        | Plugin lifecycle, commands, scheduler loop, vault access                |
| `src/settings.ts`    | Settings, run state and the settings tab                                |
| `src/sync.ts`        | Runs both jobs over a list of days; summaries                           |
| `src/scheduler.ts`   | Whether the daily run is due                                            |
| `src/dates.ts`       | Local-date helpers, path templates, sync window                         |
| `src/jobs/`          | `intake.ts` (push to Google Health), `burn.ts` (pull into the food log) |
| `src/google/`        | OAuth (`auth.ts`), generic data-points client (`client.ts`), HTTP types |
| `src/credentials.ts` | Client secret and refresh token in Obsidian secret storage              |
| `tests/`             | Vitest tests against a fake Google API and in-memory food logs          |
| `STATUS.md`          | Implementation notes and anything still to verify against the live API  |

## Releasing

1. `npm version patch` (or `minor` / `major`). This updates `package.json`,
   `manifest.json` and `versions.json`, commits, and creates a tag without a `v` prefix.
2. `git push --follow-tags`
3. The **Release** workflow builds the plugin and publishes a GitHub release with
   `main.js`, `manifest.json` and `styles.css`. BRAT picks it up from there.

## License

[GPL-3.0](LICENSE)
