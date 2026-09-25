import { describe, expect, it } from "vitest";
import {
	ALL_SCOPES,
	GoogleAuth,
	SCOPES,
	buildAuthUrl,
	extractAuthCode,
	missingScopes,
	parseScopes,
} from "../src/google/auth";
import { AuthError, type HttpClient, type HttpRequest } from "../src/google/http";
import { credentials, ok } from "./helpers";

describe("buildAuthUrl", () => {
	it("requests offline access with all three scopes", () => {
		const url = new URL(buildAuthUrl("my-client"));
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(url.searchParams.get("client_id")).toBe("my-client");
		expect(url.searchParams.get("redirect_uri")).toBe("https://www.google.com");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("scope")?.split(" ")).toEqual(ALL_SCOPES);
	});
});

describe("extractAuthCode", () => {
	it("pulls and decodes the code from a pasted redirect URL", () => {
		expect(
			extractAuthCode(
				"https://www.google.com/?code=4%2F0AbC-xyz&scope=https%3A%2F%2Fwww.googleapis.com",
			),
		).toBe("4/0AbC-xyz");
	});

	it("accepts a bare (possibly encoded) code", () => {
		expect(extractAuthCode("  4%2F0AbC-xyz ")).toBe("4/0AbC-xyz");
		expect(extractAuthCode("4/0AbC-xyz")).toBe("4/0AbC-xyz");
	});

	it("returns null when there is no code", () => {
		expect(extractAuthCode("https://www.google.com/?error=access_denied")).toBeNull();
		expect(extractAuthCode("")).toBeNull();
	});
});

describe("scopes", () => {
	it("reports missing scopes", () => {
		const granted = parseScopes(`${SCOPES.nutritionWrite} ${SCOPES.activityRead}`);
		expect(missingScopes(granted)).toEqual([SCOPES.nutritionRead]);
	});
});

describe("GoogleAuth", () => {
	function tokenServer(responses: { status: number; json: unknown }[]) {
		const requests: HttpRequest[] = [];
		const http: HttpClient = (request) => {
			requests.push(request);
			const next = responses.shift();
			if (!next) throw new Error("unexpected request");
			return Promise.resolve(next);
		};
		return { http, requests };
	}

	it("exchanges a code, stores the refresh token and returns granted scopes", async () => {
		const creds = credentials("");
		const { http, requests } = tokenServer([
			ok({
				access_token: "a1",
				expires_in: 3600,
				refresh_token: "r1",
				scope: ALL_SCOPES.join(" "),
			}),
		]);
		const auth = new GoogleAuth(http, creds);

		expect(await auth.exchangeCode("4/code")).toEqual(ALL_SCOPES);
		expect(creds.token).toBe("r1");
		const body = new URLSearchParams(requests[0]?.body);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("4/code");
		expect(body.get("redirect_uri")).toBe("https://www.google.com");
		expect(await auth.getAccessToken()).toBe("a1");
		expect(requests).toHaveLength(1);
	});

	it("refreshes on demand when the token expires within 60 seconds", async () => {
		let now = 0;
		const { http, requests } = tokenServer([
			ok({ access_token: "a1", expires_in: 3600 }),
			ok({ access_token: "a2", expires_in: 3600, refresh_token: "r2" }),
		]);
		const creds = credentials("r1");
		const auth = new GoogleAuth(http, creds, () => now);

		expect(await auth.getAccessToken()).toBe("a1");
		now = 3_000_000; // 600 s left: still valid
		expect(await auth.getAccessToken()).toBe("a1");
		now = 3_550_000; // 50 s left: refresh
		expect(await auth.getAccessToken()).toBe("a2");
		expect(creds.token).toBe("r2");
		expect(new URLSearchParams(requests[1]?.body).get("grant_type")).toBe("refresh_token");
	});

	it("clears the refresh token and throws AuthError on invalid_grant", async () => {
		const creds = credentials("r1");
		const { http } = tokenServer([{ status: 400, json: { error: "invalid_grant" } }]);
		const auth = new GoogleAuth(http, creds);

		await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
		expect(creds.token).toBe("");
	});

	it("throws AuthError when not connected", async () => {
		const auth = new GoogleAuth(tokenServer([]).http, credentials(""));
		await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
	});
});
