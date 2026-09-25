import { JOB_SCOPES, hasScopes } from "./google/auth";
import type { GoogleHealthClient } from "./google/client";
import { AuthError, TransientError, errorMessage } from "./google/http";
import { fetchBurn, writeBurn, type BurnSettings } from "./jobs/burn";
import { pushIntake, type IntakeSettings } from "./jobs/intake";
import { describeResult, type FoodLogStore, type JobResult } from "./jobs/types";

export const LOG_PREFIX = "[Google Health Sync]";

export interface DayReport {
	date: string;
	intake: JobResult;
	burn: JobResult;
}

export interface RunReport {
	/** ISO timestamp when the run started. */
	startedAt: string;
	days: DayReport[];
	/** Error that stopped the run early (network, rate limit, server, auth). */
	error?: string;
	/** True when the run stopped because Google needs to be reconnected. */
	authFailed?: boolean;
}

export interface SyncDeps {
	store: FoodLogStore;
	client: GoogleHealthClient;
	settings: IntakeSettings & BurnSettings;
	grantedScopes: readonly string[];
	now?: () => Date;
	log?: (message: string) => void;
}

/**
 * Runs both jobs for consecutive `dates`, oldest first. The jobs are independent: a skip or
 * per-day error in one doesn't affect the other. A transient or auth error stops the run.
 */
export async function runSync(dates: string[], deps: SyncDeps): Promise<RunReport> {
	const log = deps.log ?? (() => {});
	const report: RunReport = { startedAt: (deps.now?.() ?? new Date()).toISOString(), days: [] };
	const canIntake = hasScopes(deps.grantedScopes, JOB_SCOPES.intake);
	const canBurn = hasScopes(deps.grantedScopes, JOB_SCOPES.burn);

	let burnByDate = new Map<string, number>();
	let burnFetchError: string | undefined;
	if (canBurn && dates.length > 0) {
		try {
			burnByDate = await fetchBurn(dates, deps.client);
		} catch (error) {
			if (stopsRun(error)) return stop(report, error, log);
			burnFetchError = errorMessage(error);
		}
	}

	for (const date of dates) {
		let intake: JobResult = { status: "missing-scope" };
		if (canIntake) {
			try {
				intake = await pushIntake(date, deps.store, deps.client, deps.settings);
			} catch (error) {
				if (stopsRun(error)) return stop(report, error, log);
				intake = { status: "error", message: errorMessage(error) };
			}
		}

		let burn: JobResult = { status: "missing-scope" };
		if (canBurn) {
			try {
				burn = burnFetchError
					? { status: "error", message: burnFetchError }
					: await writeBurn(date, burnByDate, deps.store, deps.settings);
			} catch (error) {
				burn = { status: "error", message: errorMessage(error) };
			}
		}

		report.days.push({ date, intake, burn });
		log(
			`${LOG_PREFIX} ${date} intake: ${describeResult(intake)} · burn: ${describeResult(burn)}`,
		);
	}
	return report;
}

export function hasErrors(report: RunReport): boolean {
	return (
		report.error !== undefined ||
		report.days.some((day) => day.intake.status === "error" || day.burn.status === "error")
	);
}

/** The first error in a run, as "date job: message", for surfacing in a notice. */
export function firstError(report: RunReport): string | undefined {
	for (const day of report.days) {
		if (day.intake.status === "error") return `${day.date} intake: ${day.intake.message}`;
		if (day.burn.status === "error") return `${day.date} burn: ${day.burn.message}`;
	}
	return undefined;
}

/** One-line summary, e.g. "3 days: pushed 1, unchanged 2 · burn wrote 3". */
export function summarize(report: RunReport): string {
	const count = report.days.length;
	const intake = countStatuses(report.days.map((day) => day.intake));
	const burn = countStatuses(report.days.map((day) => day.burn));
	let summary = `${count} ${count === 1 ? "day" : "days"}: ${intake || "nothing"} · burn ${burn || "nothing"}`;
	if (report.error) summary += ` · stopped: ${report.error}`;
	return summary;
}

function countStatuses(results: JobResult[]): string {
	const labels: Record<JobResult["status"], string> = {
		pushed: "pushed",
		wrote: "wrote",
		unchanged: "unchanged",
		"no-food-log": "no food log",
		"no-total": "no total",
		"no-burn-data": "no data",
		"missing-scope": "no permission",
		error: "errors",
	};
	const counts = new Map<string, number>();
	for (const result of results) {
		const label = labels[result.status];
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts].map(([label, n]) => `${label} ${n}`).join(", ");
}

function stopsRun(error: unknown): boolean {
	return error instanceof TransientError || error instanceof AuthError;
}

function stop(report: RunReport, error: unknown, log: (message: string) => void): RunReport {
	report.error = errorMessage(error);
	report.authFailed = error instanceof AuthError;
	log(`${LOG_PREFIX} run stopped: ${report.error}`);
	return report;
}
