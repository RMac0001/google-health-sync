import { Notice, Plugin, normalizePath, requestUrl, type TFile } from "obsidian";
import { Credentials, type FallbackSecrets } from "./credentials";
import {
	addDays,
	clampLookBack,
	computeSyncWindow,
	formatLocalDate,
	parseLocalDate,
} from "./dates";
import { GoogleAuth, buildAuthUrl, extractAuthCode, missingScopes } from "./google/auth";
import { GoogleHealthClient } from "./google/client";
import { errorMessage, type HttpClient } from "./google/http";
import type { FoodLogStore } from "./jobs/types";
import { TextPromptModal } from "./modals";
import { isSyncDue } from "./scheduler";
import {
	DEFAULT_SETTINGS,
	DEFAULT_STATE,
	GoogleHealthSyncSettingTab,
	type GoogleHealthSyncSettings,
	type SyncState,
} from "./settings";
import { LOG_PREFIX, firstError, hasErrors, runSync, summarize, type RunReport } from "./sync";

interface PluginData {
	settings?: Partial<GoogleHealthSyncSettings>;
	state?: Partial<SyncState>;
	secrets?: FallbackSecrets;
}

const CHECK_INTERVAL_MS = 60_000;
/** Notice duration that keeps it on screen until clicked. */
const STICKY = 0;

export default class GoogleHealthSyncPlugin extends Plugin {
	settings: GoogleHealthSyncSettings = { ...DEFAULT_SETTINGS };
	state: SyncState = { ...DEFAULT_STATE };
	credentials!: Credentials;

	private secrets: FallbackSecrets = {};
	private auth!: GoogleAuth;
	private client!: GoogleHealthClient;
	private settingTab!: GoogleHealthSyncSettingTab;
	private running = false;

	async onload(): Promise<void> {
		await this.loadPluginData();

		const http = obsidianHttp;
		this.credentials = new Credentials(
			this.app,
			() => this.settings,
			this.secrets,
			() => {
				void this.savePluginData();
			},
		);
		this.auth = new GoogleAuth(http, this.credentials);
		this.client = new GoogleHealthClient(http, this.auth);

		this.settingTab = new GoogleHealthSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: () => void this.syncWindow(true),
		});
		this.addCommand({
			id: "sync-date",
			name: "Sync a specific date",
			callback: () => this.promptSyncDate(),
		});

		this.app.workspace.onLayoutReady(() => {
			// Catch-up: runs immediately if the sync time passed while Obsidian was closed.
			void this.checkSchedule();
			this.registerInterval(
				window.setInterval(() => void this.checkSchedule(), CHECK_INTERVAL_MS),
			);
		});
	}

	/** Has a refresh token and hasn't hit an auth failure since connecting. */
	isConnected(): boolean {
		return this.credentials.refreshToken() !== "" && !this.state.reconnectNeeded;
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	/** Opens Google's consent page, then asks for the code from the redirect URL. */
	startConnect(): void {
		if (!this.settings.clientId || !this.credentials.clientSecret()) {
			new Notice("Google Health Sync: enter the client ID and client secret first.");
			return;
		}
		window.open(buildAuthUrl(this.settings.clientId));
		new TextPromptModal(this.app, {
			title: "Connect Google Health",
			description:
				"After you allow access, Google opens www.google.com. Copy the full address from the address bar (or just the code) and paste it here.",
			placeholder: "https://www.google.com/?code=…",
			submitText: "Connect",
			validate: (value) =>
				extractAuthCode(value) ? undefined : "No code found in what you pasted.",
			onSubmit: (value) => this.completeConnect(extractAuthCode(value) ?? ""),
		}).open();
	}

	async disconnect(): Promise<void> {
		this.credentials.setRefreshToken("");
		this.auth.clear();
		this.state.grantedScopes = [];
		this.state.reconnectNeeded = false;
		await this.savePluginData();
		this.settingTab.refresh();
		new Notice("Google Health Sync: disconnected.");
	}

	private async completeConnect(code: string): Promise<void> {
		try {
			const granted = await this.auth.exchangeCode(code);
			this.state.grantedScopes = granted;
			this.state.reconnectNeeded = false;
			await this.savePluginData();
			const missing = missingScopes(granted);
			new Notice(
				missing.length === 0
					? "Google Health Sync: connected."
					: `Google Health Sync: connected, but ${missing.length} permission(s) were not granted. See settings.`,
			);
		} catch (error) {
			new Notice(`Google Health Sync: connection failed. ${errorMessage(error)}`, STICKY);
		}
		this.settingTab.refresh();
	}

	private async checkSchedule(): Promise<void> {
		const due = isSyncDue(new Date(), {
			enabled: this.settings.enabled,
			connected: this.isConnected(),
			running: this.running,
			syncTime: this.settings.syncTime,
			lastRunDate: this.state.lastRunDate,
			lastAttemptAt: this.state.lastAttemptAt,
		});
		if (due) await this.syncWindow(false);
	}

	/** The daily run: yesterday plus the look-back / catch-up window. */
	private async syncWindow(manual: boolean): Promise<void> {
		const today = formatLocalDate(new Date());
		const dates = computeSyncWindow(
			today,
			clampLookBack(this.settings.lookBackDays),
			this.state.lastProcessedDate,
		);
		const report = await this.run(dates, manual);
		if (!report) return;

		this.state.lastAttemptAt = Date.now();
		if (!hasErrors(report)) {
			this.state.lastRunDate = today;
			this.state.lastProcessedDate = addDays(today, -1);
		}
		await this.finishRun(report, manual);
	}

	private promptSyncDate(): void {
		new TextPromptModal(this.app, {
			title: "Sync a specific date",
			description: "Pushes intake and pulls burn for one day.",
			placeholder: "YYYY-MM-DD",
			submitText: "Sync",
			validate: (value) =>
				parseLocalDate(value) ? undefined : "Enter a date as YYYY-MM-DD.",
			onSubmit: async (value) => {
				const date = formatLocalDate(parseLocalDate(value) as Date);
				const report = await this.run([date], true);
				if (report) await this.finishRun(report, true);
			},
		}).open();
	}

	/** Runs both jobs for `dates` unless a run is already in progress. */
	private async run(dates: string[], manual: boolean): Promise<RunReport | null> {
		if (this.running) {
			if (manual) new Notice("Google Health Sync: a sync is already running.");
			return null;
		}
		if (!this.isConnected()) {
			if (manual)
				new Notice("Google Health Sync: connect your Google account in settings first.");
			return null;
		}
		this.running = true;
		try {
			if (manual) new Notice("Google Health Sync: syncing…");
			return await runSync(dates, {
				store: this.foodLogStore(),
				client: this.client,
				settings: this.settings,
				grantedScopes: this.state.grantedScopes,
				log: (message) => console.debug(message),
			});
		} finally {
			this.running = false;
		}
	}

	private async finishRun(report: RunReport, manual: boolean): Promise<void> {
		this.state.lastRun = report;
		if (report.authFailed) {
			this.state.reconnectNeeded = true;
			new Notice(
				"Google Health Sync: reconnect needed. Open the plugin settings to reconnect.",
				STICKY,
			);
		} else if (hasErrors(report)) {
			const detail = firstError(report);
			new Notice(
				`Google Health Sync: ${summarize(report)}${detail ? `\n${detail}` : ""}\nDetails are under Status in the plugin settings.`,
				STICKY,
			);
		} else if (manual) {
			new Notice(`Google Health Sync: ${summarize(report)}`);
		}
		if (hasErrors(report)) console.warn(`${LOG_PREFIX} ${summarize(report)}`);
		await this.savePluginData();
		this.settingTab.refresh();
	}

	private foodLogStore(): FoodLogStore {
		const { vault, metadataCache, fileManager } = this.app;
		const getFile = (path: string): TFile | null => vault.getFileByPath(normalizePath(path));
		return {
			read: (path) => {
				const file = getFile(path);
				if (!file) return null;
				return { ...(metadataCache.getFileCache(file)?.frontmatter ?? {}) };
			},
			setProperty: async (path, key, value) => {
				const file = getFile(path);
				if (!file) throw new Error(`Food log not found: ${path}`);
				await fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						frontmatter[key] = value;
					},
				);
			},
		};
	}

	private async loadPluginData(): Promise<void> {
		const data = ((await this.loadData()) as PluginData | null) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		this.state = { ...DEFAULT_STATE, ...data.state };
		Object.assign(this.secrets, data.secrets);
	}

	private async savePluginData(): Promise<void> {
		const data: PluginData = { settings: this.settings, state: this.state };
		if (this.secrets.clientSecret || this.secrets.refreshToken) data.secrets = this.secrets;
		await this.saveData(data);
	}
}

/** HttpClient backed by Obsidian's `requestUrl`, which avoids CORS restrictions. */
const obsidianHttp: HttpClient = async (request) => {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		contentType: request.contentType,
		body: request.body,
		throw: false,
	});
	let json: unknown;
	try {
		json = response.json as unknown;
	} catch {
		json = undefined;
	}
	return { status: response.status, json };
};
