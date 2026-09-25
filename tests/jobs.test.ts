import { describe, expect, it } from "vitest";
import { fetchBurn, writeBurn } from "../src/jobs/burn";
import { buildEntry, pushIntake } from "../src/jobs/intake";
import { FakeGoogle, MemoryStore, settings } from "./helpers";

const DAY = "2026-09-23";
// Local midnight-to-midnight of Sept 23 at UTC-3.
const NOON_UTC = "2026-09-23T15:00:00Z";

describe("pushIntake", () => {
	it("creates one Daily intake entry with cal_total (567 + 501 + 429 + 256 = 1753)", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, { cal_total: 567 + 501 + 429 + 256 });

		const result = await pushIntake(DAY, store, google.client(), settings);

		expect(result).toEqual({ status: "pushed", kcal: 1753 });
		expect(google.entries).toHaveLength(1);
		expect(google.entries[0]?.nutritionLog).toEqual({
			interval: {
				startTime: NOON_UTC,
				startUtcOffset: "-10800s",
				endTime: "2026-09-23T15:01:00Z",
				endUtcOffset: "-10800s",
			},
			foodDisplayName: "Daily intake",
			energy: { kcal: 1753 },
		});
	});

	it("looks up existing entries for the local day with the documented filter", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });
		await pushIntake(DAY, store, google.client(), settings);

		const list = google.apiRequests().find((r) => r.method === "GET");
		expect(new URL(list?.url ?? "").searchParams.get("filter")).toBe(
			'nutrition_log.interval.civil_start_time >= "2026-09-23" AND nutrition_log.interval.civil_start_time < "2026-09-24"',
		);
	});

	it("is unchanged on a second run and keeps exactly one entry", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });
		await pushIntake(DAY, store, google.client(), settings);

		const result = await pushIntake(DAY, store, google.client(), settings);

		expect(result).toEqual({ status: "unchanged", kcal: 1753 });
		expect(google.entries).toHaveLength(1);
	});

	it("replaces the entry when cal_total changes", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });
		await pushIntake(DAY, store, google.client(), settings);
		const oldName = google.entries[0]?.name;
		store.add(DAY, { cal_total: 1900.6 });

		const result = await pushIntake(DAY, store, google.client(), settings);

		expect(result).toEqual({ status: "pushed", kcal: 1901 });
		expect(google.entries).toHaveLength(1);
		expect(google.entries[0]?.name).not.toBe(oldName);
		expect(google.entries[0]?.nutritionLog.energy.kcal).toBe(1901);
	});

	it("collapses duplicates and never touches entries with other names", async () => {
		const google = new FakeGoogle();
		google.addEntry("Daily intake", 1753, NOON_UTC);
		google.addEntry("Daily intake", 1753, NOON_UTC);
		const banana = google.addEntry("Banana", 105, NOON_UTC);
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });

		const result = await pushIntake(DAY, store, google.client(), settings);

		expect(result).toEqual({ status: "pushed", kcal: 1753 });
		const names = google.entries.map((e) => e.nutritionLog.foodDisplayName).sort();
		expect(names).toEqual(["Banana", "Daily intake"]);
		expect(google.entries).toContainEqual(banana);
		const deleteRequest = google.apiRequests().find((r) => r.url.endsWith(":batchDelete"));
		expect(JSON.parse(deleteRequest?.body ?? "{}")).toEqual({
			names: [
				"users/me/dataTypes/nutrition-log/dataPoints/e1",
				"users/me/dataTypes/nutrition-log/dataPoints/e2",
			],
		});
	});

	it("skips without calling Google when there is no food log", async () => {
		const google = new FakeGoogle();
		const result = await pushIntake(DAY, new MemoryStore(), google.client(), settings);
		expect(result).toEqual({ status: "no-food-log" });
		expect(google.requests).toHaveLength(0);
	});

	it.each([
		[{}],
		[{ cal_total: "" }],
		[{ cal_total: "abc" }],
		[{ cal_total: 0 }],
		[{ cal_total: null }],
	])("skips when the total is missing, empty, zero or not a number: %j", async (frontmatter) => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, frontmatter);
		expect(await pushIntake(DAY, store, google.client(), settings)).toEqual({
			status: "no-total",
		});
		expect(google.entries).toHaveLength(0);
	});

	it("accepts a numeric string", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, { cal_total: "1753" });
		expect(await pushIntake(DAY, store, google.client(), settings)).toEqual({
			status: "pushed",
			kcal: 1753,
		});
	});

	// Sept 23 food log totals: protein 44+47+40+18 = 149, fat 23+17+13+8 = 61, carbs 46+40+38+28 = 152.
	const SEPT_23 = { cal_total: 1753, carbs_total: 152, fat_total: 61, protein_total: 149 };

	it("sends carbs, fat and protein with the calories", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, SEPT_23);

		expect(await pushIntake(DAY, store, google.client(), settings)).toEqual({
			status: "pushed",
			kcal: 1753,
		});
		expect(google.entries[0]?.nutritionLog).toMatchObject({
			energy: { kcal: 1753 },
			totalCarbohydrate: { grams: 152 },
			totalFat: { grams: 61 },
			energyFromFat: { kcal: 549 }, // 61 × 9
			nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 149 } }],
		});
		expect(await pushIntake(DAY, store, google.client(), settings)).toEqual({
			status: "unchanged",
			kcal: 1753,
		});
		expect(google.entries).toHaveLength(1);
	});

	it("replaces a calories-only entry so the macros get added", async () => {
		const google = new FakeGoogle();
		google.addEntry("Daily intake", 1753, NOON_UTC);
		const store = new MemoryStore().add(DAY, SEPT_23);

		expect(await pushIntake(DAY, store, google.client(), settings)).toEqual({
			status: "pushed",
			kcal: 1753,
		});
		expect(google.entries).toHaveLength(1);
		expect(google.entries[0]?.nutritionLog.totalFat).toEqual({ grams: 61 });
	});

	it("replaces the entry when only a macro changes", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, SEPT_23);
		await pushIntake(DAY, store, google.client(), settings);
		store.add(DAY, { ...SEPT_23, protein_total: 155 });

		expect((await pushIntake(DAY, store, google.client(), settings)).status).toBe("pushed");
		expect(google.entries).toHaveLength(1);
		expect(google.entries[0]?.nutritionLog.nutrients).toEqual([
			{ nutrient: "PROTEIN", quantity: { grams: 155 } },
		]);
	});

	it("leaves out a missing or zero macro instead of sending 0", async () => {
		const google = new FakeGoogle();
		const store = new MemoryStore().add(DAY, {
			cal_total: 1753,
			fat_total: 0,
			protein_total: 149,
		});

		await pushIntake(DAY, store, google.client(), settings);

		const log: Record<string, unknown> = google.entries[0]?.nutritionLog ?? {};
		expect(log).not.toHaveProperty("totalCarbohydrate");
		expect(log).not.toHaveProperty("totalFat");
		expect(log).not.toHaveProperty("energyFromFat");
		expect(log.nutrients).toEqual([{ nutrient: "PROTEIN", quantity: { grams: 149 } }]);
		expect((await pushIntake(DAY, store, google.client(), settings)).status).toBe("unchanged");
	});

	it("reports a per-day error for a rejected request", async () => {
		const google = new FakeGoogle();
		google.overrides.push((request) =>
			request.method === "POST"
				? { status: 400, json: { error: { message: "bad interval" } } }
				: undefined,
		);
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });
		const result = await pushIntake(DAY, store, google.client(), settings);
		expect(result).toMatchObject({ status: "error" });
		expect(result.status === "error" && result.message).toContain("bad interval");
	});
});

describe("buildEntry", () => {
	it("rounds energy from fat to a whole number", () => {
		const entry = buildEntry(DAY, 1753, "Daily intake", { carbs: 1, fat: 10.05 });
		expect((entry.nutritionLog as { energyFromFat: unknown }).energyFromFat).toEqual({
			kcal: 90,
		});
	});
});

describe("burn", () => {
	it("fetches the window in one request with an exclusive civil end date", async () => {
		const google = new FakeGoogle();
		google.burn.set("2026-09-21", 2310.4).set("2026-09-23", 2455.5);

		const burn = await fetchBurn(["2026-09-21", "2026-09-22", "2026-09-23"], google.client());

		expect([...burn]).toEqual([
			["2026-09-21", 2310],
			["2026-09-23", 2456],
		]);
		const rollups = google.apiRequests();
		expect(rollups).toHaveLength(1);
		expect(JSON.parse(rollups[0]?.body ?? "{}")).toEqual({
			range: {
				start: { date: { year: 2026, month: 9, day: 21 } },
				end: { date: { year: 2026, month: 9, day: 24 } },
			},
			windowSizeDays: 1,
		});
	});

	it("writes burn next to cal_total and leaves other properties alone", async () => {
		const store = new MemoryStore().add(DAY, { cal_total: 1753, protein_total: 120 });
		const result = await writeBurn(DAY, new Map([[DAY, 2456]]), store, settings);
		expect(result).toEqual({ status: "wrote", kcal: 2456 });
		expect(store.get(DAY)).toEqual({
			cal_total: 1753,
			protein_total: 120,
			calories_burned: 2456,
		});
	});

	it("is unchanged when the value already matches, and overwrites when it differs", async () => {
		const store = new MemoryStore().add(DAY, { cal_total: 1753, calories_burned: 2456 });
		expect(await writeBurn(DAY, new Map([[DAY, 2456]]), store, settings)).toEqual({
			status: "unchanged",
			kcal: 2456,
		});
		expect(await writeBurn(DAY, new Map([[DAY, 2500]]), store, settings)).toEqual({
			status: "wrote",
			kcal: 2500,
		});
		expect(store.get(DAY)?.calories_burned).toBe(2500);
	});

	it("never writes zero or creates notes", async () => {
		const store = new MemoryStore().add(DAY, { cal_total: 1753 });
		expect(await writeBurn(DAY, new Map(), store, settings)).toEqual({
			status: "no-burn-data",
		});
		expect(store.get(DAY)).toEqual({ cal_total: 1753 });

		const empty = new MemoryStore();
		expect(await writeBurn(DAY, new Map([[DAY, 2456]]), empty, settings)).toEqual({
			status: "no-food-log",
		});
		expect(empty.notes.size).toBe(0);
	});
});
