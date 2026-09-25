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
const PROTEIN = "PROTEIN";

export interface IntakeSettings {
	foodLogPath: string;
	intakeProperty: string;
	carbsProperty: string;
	fatProperty: string;
	proteinProperty: string;
	entryName: string;
}

/** Grams per macro; a macro missing (or zero) in the food log is left out, never sent as 0. */
export interface Macros {
	carbs?: number;
	fat?: number;
	protein?: number;
}

interface NutritionLog {
	foodDisplayName?: string;
	energy?: { kcal?: number };
	totalCarbohydrate?: { grams?: number };
	totalFat?: { grams?: number };
	nutrients?: { nutrient?: string; quantity?: { grams?: number } }[];
}

/**
 * Pushes a day's intake (calories plus carbs, fat and protein) to Google Health as a single
 * named nutrition log entry. Nutrition logs can't be edited, so a changed value is replaced
 * (batchDelete + create).
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
	const macros = readMacros(frontmatter, settings);

	try {
		const existing = await findEntries(date, client, settings.entryName);
		const onlyEntry = existing.length === 1 ? existing[0] : undefined;
		if (onlyEntry && entryMatches(onlyEntry, kcal, macros))
			return { status: "unchanged", kcal };

		const names = existing.map((point) => point.name).filter((name): name is string => !!name);
		if (names.length > 0) {
			checkOperation(await client.batchDeleteDataPoints(NUTRITION_LOG, names), "delete");
		}

		await createEntry(client, buildEntry(date, kcal, settings.entryName, macros));
		return { status: "pushed", kcal };
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

/** Builds the entry at 12:00–12:01 local so it stays inside `date` in any timezone view. */
export function buildEntry(
	date: string,
	kcal: number,
	entryName: string,
	macros: Macros = {},
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
	if (macros.carbs !== undefined) log.totalCarbohydrate = { grams: macros.carbs };
	if (macros.fat !== undefined) {
		log.totalFat = { grams: macros.fat };
		log.energyFromFat = { kcal: Math.round(macros.fat * 9) };
	}
	if (macros.protein !== undefined) {
		log.nutrients = [{ nutrient: PROTEIN, quantity: { grams: macros.protein } }];
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

/** True when an existing entry already has the same calories and macros as the food log. */
function entryMatches(point: DataPoint, kcal: number, macros: Macros): boolean {
	const log = nutritionLog(point);
	if (!log || typeof log.energy?.kcal !== "number" || Math.round(log.energy.kcal) !== kcal) {
		return false;
	}
	const protein = log.nutrients?.find((n) => n.nutrient === PROTEIN)?.quantity?.grams;
	return (
		sameGrams(log.totalCarbohydrate?.grams, macros.carbs) &&
		sameGrams(log.totalFat?.grams, macros.fat) &&
		sameGrams(protein, macros.protein)
	);
}

/** Compares gram values to 0.1 g; absent or zero on Google's side matches absent locally. */
function sameGrams(google: number | undefined, local: number | undefined): boolean {
	const normalized = typeof google === "number" && google > 0 ? google : undefined;
	if (normalized === undefined || local === undefined) return normalized === local;
	return Math.round(normalized * 10) === Math.round(local * 10);
}

function readMacros(frontmatter: Record<string, unknown>, settings: IntakeSettings): Macros {
	const macros: Macros = {};
	const carbs = readPositiveNumber(frontmatter, settings.carbsProperty);
	const fat = readPositiveNumber(frontmatter, settings.fatProperty);
	const protein = readPositiveNumber(frontmatter, settings.proteinProperty);
	if (carbs !== null) macros.carbs = carbs;
	if (fat !== null) macros.fat = fat;
	if (protein !== null) macros.protein = protein;
	return macros;
}
