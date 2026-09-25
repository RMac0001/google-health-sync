import type { App } from "obsidian";
import type { CredentialStore } from "./google/auth";
import type { GoogleHealthSyncSettings } from "./settings";

const CLIENT_SECRET_ID = "google-health-sync-client-secret";
const REFRESH_TOKEN_ID = "google-health-sync-refresh-token";

/** Plugin-data fallback used only if the running Obsidian lacks `app.secretStorage`. */
export interface FallbackSecrets {
	clientSecret?: string;
	refreshToken?: string;
}

/**
 * Keeps the client secret and refresh token in Obsidian's secret storage (outside the vault
 * and plugin data). Falls back to plugin data when secret storage isn't available.
 */
export class Credentials implements CredentialStore {
	constructor(
		private readonly app: App,
		private readonly settings: () => GoogleHealthSyncSettings,
		private readonly fallback: FallbackSecrets,
		private readonly persistFallback: () => void,
	) {}

	clientId(): string {
		return this.settings().clientId;
	}

	clientSecret(): string {
		return this.get(CLIENT_SECRET_ID, "clientSecret");
	}

	setClientSecret(secret: string): void {
		this.set(CLIENT_SECRET_ID, "clientSecret", secret);
	}

	refreshToken(): string {
		return this.get(REFRESH_TOKEN_ID, "refreshToken");
	}

	setRefreshToken(token: string): void {
		this.set(REFRESH_TOKEN_ID, "refreshToken", token);
	}

	private get(id: string, key: keyof FallbackSecrets): string {
		const storage = this.app.secretStorage as App["secretStorage"] | undefined;
		if (storage) return storage.getSecret(id) ?? "";
		return this.fallback[key] ?? "";
	}

	private set(id: string, key: keyof FallbackSecrets, value: string): void {
		const storage = this.app.secretStorage as App["secretStorage"] | undefined;
		if (storage) {
			storage.setSecret(id, value);
			return;
		}
		this.fallback[key] = value;
		this.persistFallback();
	}
}
