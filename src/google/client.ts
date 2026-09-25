import type { GoogleAuth } from "./auth";
import {
	ApiError,
	AuthError,
	TransientError,
	googleErrorMessage,
	send,
	type HttpClient,
	type HttpResponse,
} from "./http";

export const API_BASE = "https://health.googleapis.com/v4/users/me/dataTypes/";

export interface CivilDate {
	year: number;
	month: number;
	day: number;
}

/** Long-running operation returned by create and batchDelete. */
export interface Operation {
	name?: string;
	done?: boolean;
	error?: { code?: number; message?: string };
	response?: { name?: string } & Record<string, unknown>;
}

/** A data point; the payload lives under a data-type-specific key (e.g. `nutritionLog`). */
export interface DataPoint {
	name?: string;
	[dataTypeField: string]: unknown;
}

export interface DailyRollupDataPoint {
	civilStartTime?: { date?: CivilDate };
	civilEndTime?: { date?: CivilDate };
	[rollupField: string]: unknown;
}

interface ListResponse {
	dataPoints?: DataPoint[];
	nextPageToken?: string;
}

interface RollUpResponse {
	rollupDataPoints?: DailyRollupDataPoint[];
	nextPageToken?: string;
}

/**
 * Generic Google Health API client over `users/me/dataTypes/{dataType}/dataPoints`.
 * Data-type specifics (nutrition, calories, …) live in the jobs, so new types only need a job.
 */
export class GoogleHealthClient {
	constructor(
		private readonly http: HttpClient,
		private readonly auth: GoogleAuth,
	) {}

	/** Lists every data point matching `filter`, following pagination. */
	async listDataPoints(dataType: string, filter: string): Promise<DataPoint[]> {
		const points: DataPoint[] = [];
		let pageToken: string | undefined;
		do {
			const query: Record<string, string> = { filter };
			if (pageToken) query.pageToken = pageToken;
			const page = await this.request<ListResponse>("GET", `${dataType}/dataPoints`, {
				query,
			});
			points.push(...(page.dataPoints ?? []));
			pageToken = page.nextPageToken || undefined;
		} while (pageToken);
		return points;
	}

	createDataPoint(dataType: string, dataPoint: DataPoint): Promise<Operation> {
		return this.request<Operation>("POST", `${dataType}/dataPoints`, { body: dataPoint });
	}

	/** Deletes data points by resource name. (HTTP DELETE on a single point returns 404.) */
	batchDeleteDataPoints(dataType: string, names: string[]): Promise<Operation> {
		return this.request<Operation>("POST", `${dataType}/dataPoints:batchDelete`, {
			body: { names },
		});
	}

	/** Daily roll-up over the civil date range [start, endExclusive), one point per day. */
	async dailyRollUp(
		dataType: string,
		start: CivilDate,
		endExclusive: CivilDate,
	): Promise<DailyRollupDataPoint[]> {
		const points: DailyRollupDataPoint[] = [];
		let pageToken: string | undefined;
		do {
			const body: Record<string, unknown> = {
				range: { start: { date: start }, end: { date: endExclusive } },
				windowSizeDays: 1,
			};
			if (pageToken) body.pageToken = pageToken;
			const page = await this.request<RollUpResponse>(
				"POST",
				`${dataType}/dataPoints:dailyRollUp`,
				{ body },
			);
			points.push(...(page.rollupDataPoints ?? []));
			pageToken = page.nextPageToken || undefined;
		} while (pageToken);
		return points;
	}

	/** Sends an authorized request; on 401 refreshes the token and retries once. */
	private async request<T>(
		method: "GET" | "POST",
		path: string,
		options: { query?: Record<string, string>; body?: unknown },
	): Promise<T> {
		let url = API_BASE + path;
		if (options.query) url += `?${new URLSearchParams(options.query).toString()}`;
		const body = options.body === undefined ? undefined : JSON.stringify(options.body);

		let response = await this.authorizedSend(method, url, body);
		if (response.status === 401) {
			this.auth.invalidate();
			response = await this.authorizedSend(method, url, body);
			if (response.status === 401) {
				throw new AuthError(
					`Google rejected the access token: ${googleErrorMessage(response)}`,
				);
			}
		}
		if (response.status >= 200 && response.status < 300) return (response.json ?? {}) as T;

		const message = `${method} ${path}: ${googleErrorMessage(response)}`;
		if (response.status === 429 || response.status >= 500) throw new TransientError(message);
		throw new ApiError(response.status, message);
	}

	private async authorizedSend(
		method: "GET" | "POST",
		url: string,
		body: string | undefined,
	): Promise<HttpResponse> {
		const token = await this.auth.getAccessToken();
		return send(this.http, {
			url,
			method,
			headers: { Authorization: `Bearer ${token}` },
			contentType: body === undefined ? undefined : "application/json",
			body,
		});
	}
}
