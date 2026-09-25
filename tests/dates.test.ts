import { describe, expect, it } from "vitest";
import {
	addDays,
	computeSyncWindow,
	localDateTime,
	parseLocalDate,
	parseSyncTime,
	resolvePathTemplate,
	toUtcTimestamp,
	utcOffsetDuration,
} from "../src/dates";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("parseLocalDate", () => {
	it("parses as local midnight, not UTC", () => {
		const date = parseLocalDate("2026-09-23");
		expect(date?.getFullYear()).toBe(2026);
		expect(date?.getMonth()).toBe(8);
		expect(date?.getDate()).toBe(23);
		expect(date?.getHours()).toBe(0);
	});

	it("rejects malformed and impossible dates", () => {
		expect(parseLocalDate("2026-9-23")).toBeNull();
		expect(parseLocalDate("2026-02-30")).toBeNull();
		expect(parseLocalDate("")).toBeNull();
	});
});

describe("addDays", () => {
	it("crosses month and year boundaries", () => {
		expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
		expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
	});
});

describe("UTC conversion", () => {
	it("converts local noon to UTC with the offset (tests run at UTC-3)", () => {
		const noon = localDateTime("2026-09-23", 12);
		expect(toUtcTimestamp(noon)).toBe("2026-09-23T15:00:00Z");
		expect(utcOffsetDuration(noon)).toBe("-10800s");
	});
});

describe("resolvePathTemplate", () => {
	it("fills zero-padded tokens", () => {
		expect(resolvePathTemplate(DEFAULT_SETTINGS.foodLogPath, "2026-09-03")).toBe(
			"Data/Food Logs/FL-2026/FL-2026-09/FL-2026-09-03.md",
		);
	});
});

describe("parseSyncTime", () => {
	it("accepts 24h HH:MM", () => {
		expect(parseSyncTime("03:00")).toBe(180);
		expect(parseSyncTime("23:59")).toBe(1439);
	});

	it("rejects anything else", () => {
		expect(parseSyncTime("3:00")).toBeNull();
		expect(parseSyncTime("24:00")).toBeNull();
		expect(parseSyncTime("03:60")).toBeNull();
	});
});

describe("computeSyncWindow", () => {
	it("covers the look-back days ending yesterday", () => {
		expect(computeSyncWindow("2026-09-24", 3, "2026-09-23")).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
		]);
	});

	it("catches up from the day after the last processed date", () => {
		expect(computeSyncWindow("2026-09-27", 3, "2026-09-19")).toEqual([
			"2026-09-20",
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
			"2026-09-25",
			"2026-09-26",
		]);
	});

	it("caps the window at the 14 most recent days", () => {
		const window = computeSyncWindow("2026-09-27", 3, "2026-08-01");
		expect(window).toHaveLength(14);
		expect(window[0]).toBe("2026-09-13");
		expect(window[13]).toBe("2026-09-26");
	});

	it("uses the look-back window when nothing was processed yet", () => {
		expect(computeSyncWindow("2026-09-24", 1, undefined)).toEqual(["2026-09-23"]);
	});
});
