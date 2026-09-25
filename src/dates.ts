/**
 * Date helpers. All "date" strings are bare local calendar dates (YYYY-MM-DD).
 * Never pass one to `new Date(...)` directly — that parses it as UTC midnight.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Maximum days Google's total-calories roll-up accepts, and so the widest sync window. */
export const MAX_WINDOW_DAYS = 14;

/** Parses `YYYY-MM-DD` as local midnight. Returns null for malformed or impossible dates. */
export function parseLocalDate(value: string): Date | null {
	const match = DATE_RE.exec(value.trim());
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
		return null;
	}
	return date;
}

/** Formats a Date's local calendar date as `YYYY-MM-DD`. */
export function formatLocalDate(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Adds whole calendar days to a local date string (DST-safe). */
export function addDays(date: string, days: number): string {
	const d = requireDate(date);
	return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** Local date/time on `date` at the given hour and minute. */
export function localDateTime(date: string, hours: number, minutes = 0): Date {
	const d = requireDate(date);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes);
}

/** RFC 3339 UTC timestamp without milliseconds, e.g. `2026-09-23T15:00:00Z`. */
export function toUtcTimestamp(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Local UTC offset at `date` as a protobuf Duration string, e.g. `-10800s`. */
export function utcOffsetDuration(date: Date): string {
	return `${-date.getTimezoneOffset() * 60}s`;
}

/** `{ year, month, day }` for Google's civil Date type. */
export function toCivilDate(date: string): { year: number; month: number; day: number } {
	const d = requireDate(date);
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Replaces `{YYYY}`, `{MM}` and `{DD}` in a path template with the date's parts. */
export function resolvePathTemplate(template: string, date: string): string {
	const d = requireDate(date);
	return template
		.replace(/\{YYYY\}/g, String(d.getFullYear()))
		.replace(/\{MM\}/g, pad(d.getMonth() + 1))
		.replace(/\{DD\}/g, pad(d.getDate()));
}

/** Parses a 24h `HH:MM` time into minutes after midnight, or null if invalid. */
export function parseSyncTime(value: string): number | null {
	const match = TIME_RE.exec(value.trim());
	if (!match) return null;
	return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Days a run should cover, oldest first, always ending with yesterday.
 *
 * Starts at the earlier of the day after `lastProcessedDate` and
 * `yesterday - (lookBackDays - 1)`, capped to the most recent {@link MAX_WINDOW_DAYS}.
 */
export function computeSyncWindow(
	today: string,
	lookBackDays: number,
	lastProcessedDate: string | undefined,
): string[] {
	const yesterday = addDays(today, -1);
	let start = addDays(yesterday, -(clampLookBack(lookBackDays) - 1));
	if (lastProcessedDate && parseLocalDate(lastProcessedDate)) {
		const afterLast = addDays(lastProcessedDate, 1);
		if (afterLast < start) start = afterLast;
	}
	const earliestAllowed = addDays(yesterday, -(MAX_WINDOW_DAYS - 1));
	if (start < earliestAllowed) start = earliestAllowed;

	const days: string[] = [];
	for (let day = start; day <= yesterday; day = addDays(day, 1)) days.push(day);
	return days;
}

export function clampLookBack(days: number): number {
	if (!Number.isFinite(days)) return 1;
	return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.round(days)));
}

function requireDate(date: string): Date {
	const d = parseLocalDate(date);
	if (!d) throw new Error(`Invalid date: ${date}`);
	return d;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}
