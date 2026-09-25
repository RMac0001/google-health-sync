import { formatLocalDate } from "../src/dates";
import { GoogleAuth, type CredentialStore } from "../src/google/auth";
import { API_BASE, GoogleHealthClient, type CivilDate } from "../src/google/client";
import type { HttpClient, HttpRequest, HttpResponse } from "../src/google/http";
import type { FoodLogStore } from "../src/jobs/types";
import { DEFAULT_SETTINGS } from "../src/settings";

export const settings = { ...DEFAULT_SETTINGS };

export function foodLogPath(date: string): string {
	const [y, m] = date.split("-");
	return `Data/Food Logs/FL-${y}/FL-${y}-${m}/FL-${date}.md`;
}

/** In-memory food logs keyed by path. */
export class MemoryStore implements FoodLogStore {
	readonly notes = new Map<string, Record<string, unknown>>();

	add(date: string, frontmatter: Record<string, unknown>): this {
		this.notes.set(foodLogPath(date), { ...frontmatter });
		return this;
	}

	get(date: string): Record<string, unknown> | undefined {
		return this.notes.get(foodLogPath(date));
	}

	read(path: string): Record<string, unknown> | null {
		const note = this.notes.get(path);
		return note ? { ...note } : null;
	}

	setProperty(path: string, key: string, value: number): Promise<void> {
		const note = this.notes.get(path);
		if (!note) throw new Error(`missing ${path}`);
		note[key] = value;
		return Promise.resolve();
	}
}

interface StoredEntry {
	name: string;
	nutritionLog: {
		foodDisplayName: string;
		energy: { kcal: number };
		interval: { startTime: string; endTime: string };
		[key: string]: unknown;
	};
}

type Handler = (request: HttpRequest) => HttpResponse | undefined;

/**
 * Fake Google: token endpoint plus nutrition-log list/create/batchDelete and total-calories
 * daily roll-up, backed by in-memory data.
 */
export class FakeGoogle {
	readonly entries: StoredEntry[] = [];
	readonly requests: HttpRequest[] = [];
	/** kcalSum per `YYYY-MM-DD`; absent days return a point without totalCalories. */
	readonly burn = new Map<string, number>();
	/** Handlers consulted first, to inject failures. */
	readonly overrides: Handler[] = [];
	private nextId = 1;

	readonly http: HttpClient = (request) => {
		this.requests.push(request);
		for (const override of this.overrides) {
			const response = override(request);
			if (response) return Promise.resolve(response);
		}
		return Promise.resolve(this.handle(request));
	};

	client(): GoogleHealthClient {
		return new GoogleHealthClient(this.http, new GoogleAuth(this.http, credentials()));
	}

	addEntry(foodDisplayName: string, kcal: number, startTime: string): StoredEntry {
		const entry: StoredEntry = {
			name: `users/me/dataTypes/nutrition-log/dataPoints/e${this.nextId++}`,
			nutritionLog: {
				foodDisplayName,
				energy: { kcal },
				interval: { startTime, endTime: startTime },
			},
		};
		this.entries.push(entry);
		return entry;
	}

	apiRequests(): HttpRequest[] {
		return this.requests.filter((r) => r.url.startsWith(API_BASE));
	}

	private handle(request: HttpRequest): HttpResponse {
		if (request.url === "https://oauth2.googleapis.com/token") {
			return ok({ access_token: "access", expires_in: 3600 });
		}
		const url = new URL(request.url);
		const path = url.pathname.replace("/v4/users/me/dataTypes/", "");
		const body = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};

		if (request.method === "GET" && path === "nutrition-log/dataPoints") {
			const filter = url.searchParams.get("filter") ?? "";
			const [, from, to] =
				/civil_start_time >= "(.+?)" AND .*civil_start_time < "(.+?)"/.exec(filter) ?? [];
			const points = this.entries.filter(
				(e) =>
					from &&
					to &&
					civilDate(e.nutritionLog.interval.startTime) >= from &&
					civilDate(e.nutritionLog.interval.startTime) < to,
			);
			return ok({ dataPoints: structuredClone(points) });
		}
		if (request.method === "POST" && path === "nutrition-log/dataPoints") {
			const log = body.nutritionLog as StoredEntry["nutritionLog"];
			const entry: StoredEntry = {
				name: `users/me/dataTypes/nutrition-log/dataPoints/e${this.nextId++}`,
				nutritionLog: log,
			};
			this.entries.push(entry);
			return ok({ name: "operations/create", done: true, response: { name: entry.name } });
		}
		if (request.method === "POST" && path === "nutrition-log/dataPoints:batchDelete") {
			const names = body.names as string[];
			for (const name of names) {
				const index = this.entries.findIndex((e) => e.name === name);
				if (index >= 0) this.entries.splice(index, 1);
			}
			return ok({ name: "operations/delete", done: true, response: {} });
		}
		if (request.method === "POST" && path === "total-calories/dataPoints:dailyRollUp") {
			const range = body.range as { start: { date: CivilDate }; end: { date: CivilDate } };
			const points = [];
			for (
				let d = new Date(
					range.start.date.year,
					range.start.date.month - 1,
					range.start.date.day,
				);
				d < new Date(range.end.date.year, range.end.date.month - 1, range.end.date.day);
				d.setDate(d.getDate() + 1)
			) {
				const civil = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
				const key = `${civil.year}-${String(civil.month).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
				const kcal = this.burn.get(key);
				points.push({
					civilStartTime: { date: civil },
					...(kcal === undefined ? {} : { totalCalories: { kcalSum: kcal } }),
				});
			}
			return ok({ rollupDataPoints: points });
		}
		return { status: 404, json: { error: { message: `no route ${request.method} ${path}` } } };
	}
}

/** Local calendar date of a UTC timestamp, as Google computes `civil_start_time`. */
function civilDate(utc: string): string {
	return formatLocalDate(new Date(utc));
}

export function ok(json: unknown): HttpResponse {
	return { status: 200, json };
}

export function credentials(refreshToken = "refresh"): CredentialStore & { token: string } {
	const store = {
		token: refreshToken,
		clientId: () => "client-id",
		clientSecret: () => "client-secret",
		refreshToken: () => store.token,
		setRefreshToken: (token: string) => {
			store.token = token;
		},
	};
	return store;
}
