import {
	addDays,
	localDateTime,
	resolvePathTemplate,
	toUtcTimestamp,
	utcOffsetDuration,
} from "../dates";
import type { DataPoint, GoogleHealthClient, Operation } from "../google/client";
import { ApiError } from "../google/http";
import { readPositiveNumber, type FoodLogStore, type JobResult } from "./types";

export const NUTRITION_LOG = "nutrition-log";

export interface IntakeSettings {
	foodLogPath: string;
	intakeProperty: string;
	carbsProperty: string;
	fatProperty: string;
	entryName: string;
}

interface NutritionLog {
	foodDisplayName?: string;
	energy?: { kcal?: number };
}

/**
 * Pushes a day's intake total to Google Health as a single named nutrition log entry.
 * Nutrition logs can't be edited, so a changed value is replaced (batchDelete + create).
 *
 * Throws {@link TransientError} / {@link AuthError} so the caller can stop the run;
 * other API failures become an "error" result for the day.
 */
export async function pushIntake(
	date: string,
	store: FoodLogStore,
	client: GoogleHealthClient,
	settings: IntakeSettings,
): Promise<JobResult> {
	const frontmatter = store.read(resolvePathTemplate(settings.foodLogPath, date));
	if (!frontmatter) return { status: "no-food-log" };
	const total = readPositiveNumber(frontmatter, settings.intakeProperty);
	if (total === null) return { status: "no-total" };
	const kcal = Math.round(total);

	try {
		const existing = await findEntries(date, client, settings.entryName);
		const onlyEntry = existing.length === 1 ? existing[0] : undefined;
		if (onlyEntry && entryKcal(onlyEntry) === kcal) return { status: "unchanged", kcal };

		const names = existing.map((point) => point.name).filter((name): name is string => !!name);
		if (names.length > 0) {
			checkOperation(await client.batchDeleteDataPoints(NUTRITION_LOG, names), "delete");
		}

		try {
			await createEntry(client, buildEntry(date, kcal, settings.entryName));
			return { status: "pushed", kcal };
		} catch (error) {
			if (!requiresMacros(error)) throw error;
			const macros = readMacros(frontmatter, settings);
			if (!macros) {
				return {
					status: "error",
					message: `Google requires carbs and fat, but "${settings.carbsProperty}" / "${settings.fatProperty}" are missing from the food log.`,
				};
			}
			await createEntry(client, buildEntry(date, kcal, settings.entryName, macros));
			return { status: "pushed", kcal, withMacros: true };
		}
	} catch (error) {
		if (error instanceof ApiError) return { status: "error", message: error.message };
		throw error;
	}
}

/** Entries on local day `date` whose name matches the entry name. */
async function findEntries(
	date: string,
	client: GoogleHealthClient,
	entryName: string,
): Promise<DataPoint[]> {
	// Nutrition logs are a session type, which Google only lets you filter by civil (local) time.
	const filter = `nutrition_log.interval.civil_start_time >= "${date}" AND nutrition_log.interval.civil_start_time < "${addDays(date, 1)}"`;
	const points = await client.listDataPoints(NUTRITION_LOG, filter);
	return points.filter((point) => nutritionLog(point)?.foodDisplayName === entryName);
}

interface Macros {
	carbs: number;
	fat: number;
}

/** Builds the entry at 12:00–12:01 local so it stays inside `date` in any timezone view. */
export function buildEntry(
	date: string,
	kcal: number,
	entryName: string,
	macros?: Macros,
): DataPoint {
	const start = localDateTime(date, 12, 0);
	const end = localDateTime(date, 12, 1);
	const log: Record<string, unknown> = {
		interval: {
			startTime: toUtcTimestamp(start),
			startUtcOffset: utcOffsetDuration(start),
			endTime: toUtcTimestamp(end),
			endUtcOffset: utcOffsetDuration(end),
		},
		foodDisplayName: entryName,
		energy: { kcal },
	};
	if (macros) {
		log.totalCarbohydrate = { grams: macros.carbs };
		log.totalFat = { grams: macros.fat };
		log.energyFromFat = { kcal: Math.round(macros.fat * 9) };
	}
	return { nutritionLog: log };
}

async function createEntry(client: GoogleHealthClient, entry: DataPoint): Promise<void> {
	checkOperation(await client.createDataPoint(NUTRITION_LOG, entry), "create", true);
}

function checkOperation(operation: Operation, action: string, requireName = false): void {
	if (operation.error) {
		throw new ApiError(400, `${action} failed: ${operation.error.message ?? "unknown error"}`);
	}
	if (operation.done !== true || (requireName && !operation.response?.name)) {
		throw new ApiError(200, `${action} did not complete (operation ${operation.name ?? "?"})`);
	}
}

function nutritionLog(point: DataPoint): NutritionLog | undefined {
	return point.nutritionLog as NutritionLog | undefined;
}

function entryKcal(point: DataPoint): number | undefined {
	const kcal = nutritionLog(point)?.energy?.kcal;
	return typeof kcal === "number" ? Math.round(kcal) : undefined;
}

/** True when Google rejected a create because macro fields are required. */
function requiresMacros(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		error.status === 400 &&
		/total_?carbohydrate|total_?fat|energy_?from_?fat/i.test(error.message)
	);
}

function readMacros(frontmatter: Record<string, unknown>, settings: IntakeSettings): Macros | null {
	const carbs = readPositiveNumber(frontmatter, settings.carbsProperty);
	const fat = readPositiveNumber(frontmatter, settings.fatProperty);
	return carbs === null || fat === null ? null : { carbs, fat };
}
