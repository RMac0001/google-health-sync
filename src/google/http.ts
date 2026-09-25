/**
 * Minimal HTTP abstraction so the Google client can be unit-tested without Obsidian.
 * The plugin passes an implementation backed by Obsidian's `requestUrl`.
 */

export interface HttpRequest {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	contentType?: string;
	body?: string;
}

export interface HttpResponse {
	status: number;
	/** Parsed JSON body, or undefined when the body is empty or not JSON. */
	json: unknown;
}

/** Performs a request and resolves for every HTTP status; rejects only on network failure. */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

/** Google needs to be reconnected (refresh token revoked/expired, or never connected). */
export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

/** Worth retrying later: network failure, rate limit or server error. */
export class TransientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TransientError";
	}
}

/** A request Google rejected (4xx other than auth/rate-limit). */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** Runs the request, converting network failures into {@link TransientError}. */
export async function send(http: HttpClient, request: HttpRequest): Promise<HttpResponse> {
	try {
		return await http(request);
	} catch (error) {
		throw new TransientError(`Network error: ${errorMessage(error)}`);
	}
}

/** Extracts Google's error message from a JSON error body. */
export function googleErrorMessage(response: HttpResponse): string {
	const body = response.json as
		{ error?: { message?: string } | string; error_description?: string } | undefined;
	if (body && typeof body.error === "object" && body.error.message) return body.error.message;
	if (body?.error_description) return body.error_description;
	if (body && typeof body.error === "string") return body.error;
	return `HTTP ${response.status}`;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
