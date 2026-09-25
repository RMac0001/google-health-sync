# Implementation status

Built from the Google Health Sync spec (Sep 24, 2026). Everything in the spec is implemented
and covered by unit tests against a fake Google API. It has **not yet been run against the
live Google Health API** — see "To verify" below.

## Where the API details came from

The Google Health developer docs weren't reachable from the build environment, so request
shapes were checked against the type definitions in Google's generated client,
`@googleapis/health` v6 (`build/v4.d.ts`):

- List filter: nutrition logs are a **session** data type (their interval is a
  `SessionTimeInterval`), and session types only support civil-time filters:
  `nutrition_log.interval.civil_start_time >= "YYYY-MM-DD" AND … < "YYYY-MM-DD"`.
  (`nutrition_log.interval.start_time` is rejected with
  `INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER`, confirmed live in 0.2.0.) Results are
  paginated with `nextPageToken`.
- `dataPoints.create` and `dataPoints:batchDelete` return an `Operation`
  (`done`, `error`, `response`).
- `dataPoints:dailyRollUp` takes `range` as a closed-open `CivilTimeInterval`
  (`start.date` / `end.date`) plus `windowSizeDays`; the maximum range for `total-calories`
  is 14 days. Each `rollupDataPoints[]` item has `civilStartTime.date` and
  `totalCalories.kcalSum`.
- `NutritionLog.interval` is a `SessionTimeInterval`, where `startUtcOffset` and
  `endUtcOffset` are **required**, so they are always sent (e.g. `"-10800s"`).
- `totalCarbohydrate`, `totalFat` and `energyFromFat` are marked **optional**, so the entry is
  sent with calories only.

## Deviations from the spec

- **Plugin id is `google-health-sync`**, not `obsidian-google-health-sync`: Obsidian rejects
  plugin ids containing "obsidian". The repo and display name are unchanged.
- **`serving` is omitted from the nutrition entry.** In the API, `serving.foodMeasurementUnit`
  is required whenever `serving` is present, and it refers to a measurement-unit resource the
  plugin doesn't have. `serving` itself is optional. If Google turns out to require it, the
  create call will fail with a per-day error in Status.
- **Macros are sent too** (added in 0.2.2 at Roger's request; the spec was calories only).
  Each entry carries `totalCarbohydrate`, `totalFat`, `energyFromFat = round(fat × 9)` and
  protein as `nutrients: [{ nutrient: "PROTEIN", quantity: { grams } }]`, read from
  `carbs_total`, `fat_total` and `protein_total` (all settings). A macro that is missing or
  0 in the food log is left out rather than sent as 0. An existing entry counts as
  "unchanged" only if calories and all three macros match (to 0.1 g), so calories-only entries
  from earlier versions are replaced on the next run.
- **A zero is treated as missing**, for both `cal_total` and Google's `kcalSum`: a food log
  whose total is 0 hasn't been filled in, and a 0 burn means no data. Neither is pushed or
  written.
- **Log level:** per-day results go to `console.debug` (Obsidian's plugin guidelines, enforced
  by the linter, disallow `console.log`). Enable "Verbose" in the dev tools console to see them.

## Behaviour notes

- A run is recorded as complete (`lastRunDate` / `lastProcessedDate` updated) only when
  there are no errors. Skips such as "no food log" or "no burn data" are not errors.
- Rate limits (429), server errors (5xx) and network failures stop the run; the scheduler
  retries no sooner than 15 minutes later. Other rejected requests (4xx) are recorded as a
  per-day error for that job, and the other job carries on.
- A 401 from the API triggers one token refresh and one retry. `invalid_grant` on refresh
  clears the stored refresh token and sets "Reconnect needed", which stops scheduled runs
  until you reconnect.
- If a changed value's old entry is deleted but the new create fails, the day has no entry
  until the next successful run (retried after 15 minutes). This follows from nutrition
  entries not being editable.
- "Sync a specific date" shows its results under Status, but doesn't change `lastRunDate` or
  `lastProcessedDate`.

## Verified live

- OAuth connect with all three scopes (0.2.0).
- Burn pull: `total-calories` daily roll-up and writing `calories_burned` (0.2.0).

## To verify against the live API

Run the spec's acceptance checks in a test vault:

1. Connect: Status shows all three permissions granted.
2. Sync a specific date, 2026-09-23: one "Daily intake" entry of 1753 kcal.
3. Run it again: "unchanged", still one entry.
4. Change `cal_total`, run again: the old entry is gone and one new entry has the new value.
5. `FL-2026-09-23.md` gets `calories_burned`; other frontmatter untouched.
6. A date with no food log: both jobs skipped, nothing created.
7. Obsidian closed at the sync time: opening it later runs the catch-up once.
8. Close and reopen on the same day: no second run.

Things most likely to need a tweak: whether create accepts an entry without `serving`, and
whether the list endpoint needs a `pageSize` for nutrition logs.
