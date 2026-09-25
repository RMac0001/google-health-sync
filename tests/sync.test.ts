import { describe, expect, it } from "vitest";
import { ALL_SCOPES, SCOPES } from "../src/google/auth";
import { RETRY_DELAY_MS, isSyncDue } from "../src/scheduler";
import { firstError, hasErrors, runSync, summarize } from "../src/sync";
import { FakeGoogle, MemoryStore, settings } from "./helpers";

const DATES = ["2026-09-21", "2026-09-22", "2026-09-23"];

function deps(
	google: FakeGoogle,
	store: MemoryStore,
	grantedScopes: readonly string[] = ALL_SCOPES,
) {
	return { store, client: google.client(), settings, grantedScopes };
}

describe("runSync", () => {
	it("runs both jobs per day, oldest first, and summarizes", async () => {
		const google = new FakeGoogle();
		google.burn.set("2026-09-21", 2300).set("2026-09-22", 2400).set("2026-09-23", 2500);
		const store = new MemoryStore()
			.add("2026-09-21", { cal_total: 1800 })
			.add("2026-09-22", { cal_total: 1700 })
			.add("2026-09-23", { cal_total: 1753 });
		await runSync(["2026-09-21"], deps(google, store));

		const report = await runSync(DATES, deps(google, store));

		expect(report.days.map((d) => d.date)).toEqual(DATES);
		expect(summarize(report)).toBe("3 days: unchanged 1, pushed 2 · burn unchanged 1, wrote 2");
		expect(hasErrors(report)).toBe(false);
		expect(google.entries).toHaveLength(3);
		expect(store.get("2026-09-23")?.calories_burned).toBe(2500);
	});

	it("skips both jobs for a day with no food log and creates nothing", async () => {
		const google = new FakeGoogle();
		google.burn.set("2026-09-23", 2500);
		const store = new MemoryStore();

		const report = await runSync(["2026-09-23"], deps(google, store));

		expect(report.days[0]).toEqual({
			date: "2026-09-23",
			intake: { status: "no-food-log" },
			burn: { status: "no-food-log" },
		});
		expect(google.entries).toHaveLength(0);
		expect(store.notes.size).toBe(0);
	});

	it("runs only the job whose scopes were granted", async () => {
		const google = new FakeGoogle();
		google.burn.set("2026-09-23", 2500);
		const store = new MemoryStore().add("2026-09-23", { cal_total: 1753 });

		const report = await runSync(["2026-09-23"], deps(google, store, [SCOPES.activityRead]));

		expect(report.days[0]?.intake).toEqual({ status: "missing-scope" });
		expect(report.days[0]?.burn).toEqual({ status: "wrote", kcal: 2500 });
		expect(google.entries).toHaveLength(0);
	});

	it("keeps pulling burn when intake has an error for a day", async () => {
		const google = new FakeGoogle();
		google.burn.set("2026-09-23", 2500);
		google.overrides.push((r) =>
			r.method === "GET"
				? { status: 403, json: { error: { message: "forbidden" } } }
				: undefined,
		);
		const store = new MemoryStore().add("2026-09-23", { cal_total: 1753 });

		const report = await runSync(["2026-09-23"], deps(google, store));

		expect(report.days[0]?.intake.status).toBe("error");
		expect(report.days[0]?.burn).toEqual({ status: "wrote", kcal: 2500 });
		expect(hasErrors(report)).toBe(true);
		expect(firstError(report)).toContain("2026-09-23 intake:");
		expect(firstError(report)).toContain("forbidden");
	});

	it("stops the run on a rate limit", async () => {
		const google = new FakeGoogle();
		google.overrides.push((r) =>
			r.url.includes(":dailyRollUp")
				? { status: 429, json: { error: { message: "slow down" } } }
				: undefined,
		);
		const store = new MemoryStore().add("2026-09-23", { cal_total: 1753 });

		const report = await runSync(DATES, deps(google, store));

		expect(report.days).toHaveLength(0);
		expect(report.error).toContain("slow down");
		expect(report.authFailed).toBe(false);
		expect(hasErrors(report)).toBe(true);
	});

	it("refreshes once and retries a call that returns 401", async () => {
		const google = new FakeGoogle();
		let rejected = false;
		google.overrides.push((r) => {
			if (!rejected && r.url.includes(":dailyRollUp")) {
				rejected = true;
				return { status: 401, json: { error: { message: "expired" } } };
			}
			return undefined;
		});
		google.burn.set("2026-09-23", 2500);
		const store = new MemoryStore().add("2026-09-23", { cal_total: 1753 });

		const report = await runSync(["2026-09-23"], deps(google, store));

		expect(report.error).toBeUndefined();
		expect(report.days[0]?.burn).toEqual({ status: "wrote", kcal: 2500 });
		const tokenCalls = google.requests.filter((r) => r.url.includes("oauth2.googleapis.com"));
		expect(tokenCalls).toHaveLength(2);
	});

	it("flags an auth failure", async () => {
		const google = new FakeGoogle();
		google.overrides.push((r) =>
			r.url.includes("oauth2.googleapis.com")
				? { status: 400, json: { error: "invalid_grant" } }
				: undefined,
		);
		const report = await runSync(DATES, deps(google, new MemoryStore()));
		expect(report.authFailed).toBe(true);
	});
});

describe("isSyncDue", () => {
	const base = { enabled: true, connected: true, running: false, syncTime: "03:00" };
	const at = (time: string) => new Date(`2026-09-24T${time}:00`);

	it("runs at or after the sync time once per day", () => {
		expect(isSyncDue(at("02:59"), base)).toBe(false);
		expect(isSyncDue(at("03:00"), base)).toBe(true);
		expect(isSyncDue(at("14:00"), { ...base, lastRunDate: "2026-09-23" })).toBe(true);
		expect(isSyncDue(at("14:00"), { ...base, lastRunDate: "2026-09-24" })).toBe(false);
	});

	it("respects the switches and in-progress guard", () => {
		expect(isSyncDue(at("04:00"), { ...base, enabled: false })).toBe(false);
		expect(isSyncDue(at("04:00"), { ...base, connected: false })).toBe(false);
		expect(isSyncDue(at("04:00"), { ...base, running: true })).toBe(false);
		expect(isSyncDue(at("04:00"), { ...base, syncTime: "bad" })).toBe(false);
	});

	it("waits 15 minutes between failed attempts", () => {
		const now = at("04:00");
		expect(isSyncDue(now, { ...base, lastAttemptAt: now.getTime() - RETRY_DELAY_MS + 1 })).toBe(
			false,
		);
		expect(isSyncDue(now, { ...base, lastAttemptAt: now.getTime() - RETRY_DELAY_MS })).toBe(
			true,
		);
	});
});
