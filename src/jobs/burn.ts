import { addDays, formatLocalDate, resolvePathTemplate, toCivilDate } from "../dates";
import type { DailyRollupDataPoint, GoogleHealthClient } from "../google/client";
import { readPositiveNumber, type FoodLogStore, type JobResult } from "./types";

export const TOTAL_CALORIES = "total-calories";

export interface BurnSettings {
	foodLogPath: string;
	burnProperty: string;
}

/**
 * Fetches total calories burned (resting + active) for consecutive `dates` in one daily
 * roll-up request. Days with no data are absent from the result — never zero-filled.
 */
export async function fetchBurn(
	dates: string[],
	client: GoogleHealthClient,
): Promise<Map<string, number>> {
	const burn = new Map<string, number>();
	const first = dates[0];
	const last = dates[dates.length - 1];
	if (!first || !last) return burn;

	const points = await client.dailyRollUp(
		TOTAL_CALORIES,
		toCivilDate(first),
		toCivilDate(addDays(last, 1)),
	);
	for (const point of points) {
		const date = rollupDate(point);
		const kcal = (point.totalCalories as { kcalSum?: unknown } | undefined)?.kcalSum;
		if (date && typeof kcal === "number" && Number.isFinite(kcal) && kcal > 0) {
			burn.set(date, Math.round(kcal));
		}
	}
	return burn;
}

/** Writes a day's burn into its existing food log. Never creates the note. */
export async function writeBurn(
	date: string,
	burnByDate: ReadonlyMap<string, number>,
	store: FoodLogStore,
	settings: BurnSettings,
): Promise<JobResult> {
	const path = resolvePathTemplate(settings.foodLogPath, date);
	const frontmatter = store.read(path);
	if (!frontmatter) return { status: "no-food-log" };

	const kcal = burnByDate.get(date);
	if (kcal === undefined) return { status: "no-burn-data" };

	const current = readPositiveNumber(frontmatter, settings.burnProperty);
	if (current !== null && Math.round(current) === kcal) return { status: "unchanged", kcal };

	await store.setProperty(path, settings.burnProperty, kcal);
	return { status: "wrote", kcal };
}

function rollupDate(point: DailyRollupDataPoint): string | null {
	const date = point.civilStartTime?.date;
	if (!date?.year || !date.month || !date.day) return null;
	return formatLocalDate(new Date(date.year, date.month - 1, date.day));
}
