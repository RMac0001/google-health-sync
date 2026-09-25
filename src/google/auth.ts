import {
	ApiError,
	AuthError,
	TransientError,
	googleErrorMessage,
	send,
	type HttpClient,
	type HttpResponse,
} from "./http";

export const SCOPES = {
	nutritionWrite: "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
	nutritionRead: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
	activityRead: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
} as const;

export const ALL_SCOPES: readonly string[] = Object.values(SCOPES);

/** Scopes each job needs. Intake reads existing entries (duplicate protection) and writes. */
export const JOB_SCOPES = {
	intake: [SCOPES.nutritionWrite, SCOPES.nutritionRead],
	burn: [SCOPES.activityRead],
} as const;

export const REDIRECT_URI = "https://www.google.com";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Refresh when the access token expires within this many milliseconds. */
const EXPIRY_MARGIN_MS = 60_000;

export function buildAuthUrl(clientId: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		access_type: "offline",
		prompt: "consent",
		scope: ALL_SCOPES.join(" "),
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Accepts either the full redirect URL (`https://www.google.com/?code=…&scope=…`) or the bare
 * code, and returns the decoded authorization code.
 */
export function extractAuthCode(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed) || trimmed.includes("code=")) {
		try {
			const url = new URL(trimmed, REDIRECT_URI);
			return url.searchParams.get("code") || null;
		} catch {
			return null;
		}
	}
	try {
		return decodeURIComponent(trimmed);
	} catch {
		return trimmed;
	}
}

export function parseScopes(scope: string | undefined): string[] {
	return (scope ?? "").split(/\s+/).filter(Boolean);
}

export function missingScopes(granted: readonly string[], required = ALL_SCOPES): string[] {
	return required.filter((scope) => !granted.includes(scope));
}

export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
	return missingScopes(granted, required).length === 0;
}

/** Where credentials live. Backed by Obsidian secret storage in the plugin. */
export interface CredentialStore {
	clientId(): string;
	clientSecret(): string;
	refreshToken(): string;
	setRefreshToken(token: string): void;
}

interface TokenResponse {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

/**
 * OAuth 2.0 authorization-code flow. The access token lives in memory only and is refreshed
 * on demand; the refresh token is persisted through the {@link CredentialStore}.
 */
export class GoogleAuth {
	private accessToken: string | null = null;
	private expiresAt = 0;

	constructor(
		private readonly http: HttpClient,
		private readonly credentials: CredentialStore,
		private readonly now: () => number = Date.now,
	) {}

	/** Exchanges an authorization code for tokens; returns the granted scopes. */
	async exchangeCode(code: string): Promise<string[]> {
		const response = await this.tokenRequest({
			code,
			client_id: this.credentials.clientId(),
			client_secret: this.credentials.clientSecret(),
			redirect_uri: REDIRECT_URI,
			grant_type: "authorization_code",
		});
		if (response.status !== 200) {
			throw new ApiError(response.status, googleErrorMessage(response));
		}
		const body = response.json as TokenResponse;
		if (!body.refresh_token) {
			throw new ApiError(
				response.status,
				"Google did not return a refresh token. Remove the app's access in your Google account and connect again.",
			);
		}
		this.credentials.setRefreshToken(body.refresh_token);
		this.storeAccessToken(body);
		return parseScopes(body.scope);
	}

	/** Returns a valid access token, refreshing it if missing or about to expire. */
	async getAccessToken(): Promise<string> {
		if (this.accessToken && this.expiresAt - this.now() > EXPIRY_MARGIN_MS) {
			return this.accessToken;
		}
		const refreshToken = this.credentials.refreshToken();
		if (!refreshToken) throw new AuthError("Not connected to Google.");

		const response = await this.tokenRequest({
			refresh_token: refreshToken,
			client_id: this.credentials.clientId(),
			client_secret: this.credentials.clientSecret(),
			grant_type: "refresh_token",
		});
		if (response.status === 200) {
			const body = response.json as TokenResponse;
			if (body.refresh_token) this.credentials.setRefreshToken(body.refresh_token);
			return this.storeAccessToken(body);
		}
		const error = (response.json as { error?: string } | undefined)?.error;
		if (error === "invalid_grant") {
			this.clear();
			this.credentials.setRefreshToken("");
			throw new AuthError("Google access was revoked or expired. Reconnect needed.");
		}
		if (response.status === 429 || response.status >= 500) {
			throw new TransientError(`Token refresh failed: ${googleErrorMessage(response)}`);
		}
		throw new ApiError(
			response.status,
			`Token refresh failed: ${googleErrorMessage(response)}`,
		);
	}

	/** Forgets the in-memory access token so the next call refreshes it. */
	invalidate(): void {
		this.accessToken = null;
		this.expiresAt = 0;
	}

	clear(): void {
		this.invalidate();
	}

	private storeAccessToken(body: TokenResponse): string {
		if (!body.access_token) throw new ApiError(200, "Google returned no access token.");
		this.accessToken = body.access_token;
		this.expiresAt = this.now() + (body.expires_in ?? 3600) * 1000;
		return this.accessToken;
	}

	private tokenRequest(params: Record<string, string>): Promise<HttpResponse> {
		return send(this.http, {
			url: TOKEN_ENDPOINT,
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: new URLSearchParams(params).toString(),
		});
	}
}
