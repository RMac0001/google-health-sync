/** Read/write access to food log notes. Backed by the Obsidian vault in the plugin. */
export interface FoodLogStore {
	/** Frontmatter of the note at `path` (`{}` if it has none), or null if the note doesn't exist. */
	read(path: string): Record<string, unknown> | null;
	/** Sets one frontmatter property, adding it if absent and leaving other keys untouched. */
	setProperty(path: string, key: string, value: number): Promise<void>;
}

export type JobResult =
	| { status: "pushed"; kcal: number }
	| { status: "wrote"; kcal: number }
	| { status: "unchanged"; kcal: number }
	| { status: "no-food-log" }
	| { status: "no-total" }
	| { status: "no-burn-data" }
	| { status: "missing-scope" }
	| { status: "error"; message: string };

/**
 * Reads a numeric frontmatter value. Returns null when missing, empty or not a number, and
 * also for zero or negative values: a food log with 0 is unfilled, not a real day's total.
 */
export function readPositiveNumber(
	frontmatter: Record<string, unknown>,
	key: string,
): number | null {
	const raw = frontmatter[key];
	let value: number;
	if (typeof raw === "number") value = raw;
	else if (typeof raw === "string" && raw.trim() !== "") value = Number(raw);
	else return null;
	return Number.isFinite(value) && value > 0 ? value : null;
}

export function describeResult(result: JobResult): string {
	switch (result.status) {
		case "pushed":
			return `pushed ${result.kcal}`;
		case "wrote":
			return `wrote ${result.kcal}`;
		case "unchanged":
			return `unchanged (${result.kcal})`;
		case "no-food-log":
			return "no food log";
		case "no-total":
			return "no total";
		case "no-burn-data":
			return "no burn data";
		case "missing-scope":
			return "skipped (permission not granted)";
		case "error":
			return `error: ${result.message}`;
	}
}
