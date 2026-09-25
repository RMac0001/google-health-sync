import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSyncInterval } from "../src/settings";

describe("validateSyncInterval", () => {
	it("accepts 0 and positive whole numbers", () => {
		expect(validateSyncInterval(0)).toBeUndefined();
		expect(validateSyncInterval(15)).toBeUndefined();
	});

	it("rejects negative or fractional values", () => {
		expect(validateSyncInterval(-5)).toBeTypeOf("string");
		expect(validateSyncInterval(1.5)).toBeTypeOf("string");
		expect(validateSyncInterval(Number.NaN)).toBeTypeOf("string");
	});
});

describe("DEFAULT_SETTINGS", () => {
	it("disables auto-sync by default", () => {
		expect(DEFAULT_SETTINGS.syncIntervalMinutes).toBe(0);
	});
});
