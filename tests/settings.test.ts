import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSyncInterval } from "../src/settings";

describe("parseSyncInterval", () => {
	it("parses positive integers", () => {
		expect(parseSyncInterval("15")).toBe(15);
	});

	it("falls back to 0 for invalid or non-positive input", () => {
		expect(parseSyncInterval("")).toBe(0);
		expect(parseSyncInterval("abc")).toBe(0);
		expect(parseSyncInterval("-5")).toBe(0);
	});
});

describe("DEFAULT_SETTINGS", () => {
	it("disables auto-sync by default", () => {
		expect(DEFAULT_SETTINGS.syncIntervalMinutes).toBe(0);
	});
});
