import {
	Notice,
	PluginSettingTab,
	debounce,
	type App,
	type Setting,
	type SettingDefinitionItem,
} from "obsidian";
import { MAX_WINDOW_DAYS, parseSyncTime } from "./dates";
import { SCOPES, missingScopes } from "./google/auth";
import { describeResult } from "./jobs/types";
import type GoogleHealthSyncPlugin from "./main";
import type { RunReport } from "./sync";

export interface GoogleHealthSyncSettings {
	enabled: boolean;
	/** Local 24h `HH:MM`. */
	syncTime: string;
	lookBackDays: number;
	/** Vault path template with `{YYYY}`, `{MM}`, `{DD}` tokens. */
	foodLogPath: string;
	intakeProperty: string;
	burnProperty: string;
	/** Only used if Google refuses a calories-only nutrition entry. */
	carbsProperty: string;
	fatProperty: string;
	entryName: string;
	clientId: string;
}

type SettingKey = keyof GoogleHealthSyncSettings;

export const DEFAULT_SETTINGS: GoogleHealthSyncSettings = {
	enabled: false,
	syncTime: "03:00",
	lookBackDays: 3,
	foodLogPath: "Data/Food Logs/FL-{YYYY}/FL-{YYYY}-{MM}/FL-{YYYY}-{MM}-{DD}.md",
	intakeProperty: "cal_total",
	burnProperty: "calories_burned",
	carbsProperty: "carbs_total",
	fatProperty: "fat_total",
	entryName: "Daily intake",
	clientId: "",
};

/** Run bookkeeping, stored in plugin data next to the settings. */
export interface SyncState {
	/** Local date of the last completed scheduled/"Sync now" run. */
	lastRunDate?: string;
	/** Last day (yesterday at the time) covered by a completed run. */
	lastProcessedDate?: string;
	/** Epoch ms of the last run attempt, for the 15-minute retry delay. */
	lastAttemptAt?: number;
	lastRun?: RunReport;
	grantedScopes: string[];
	reconnectNeeded: boolean;
}

export const DEFAULT_STATE: SyncState = { grantedScopes: [], reconnectNeeded: false };

const SCOPE_LABELS: Record<string, string> = {
	[SCOPES.nutritionWrite]: "Nutrition write (push intake)",
	[SCOPES.nutritionRead]: "Nutrition read (find existing entries)",
	[SCOPES.activityRead]: "Activity read (calories burned)",
};

export class GoogleHealthSyncSettingTab extends PluginSettingTab {
	private readonly showSaved = debounce(
		() => new Notice("Google Health Sync: settings saved"),
		1000,
		true,
	);
	private readonly dynamicRenderers = new Set<() => void>();

	constructor(
		app: App,
		private readonly plugin: GoogleHealthSyncPlugin,
	) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			typeof value === "string" ? value.trim() : value;
		await this.plugin.saveSettings();
		this.showSaved();
	}

	/** Re-renders the account and status sections, and re-evaluates disabled states. */
	refresh(): void {
		for (const render of this.dynamicRenderers) render();
		this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				type: "group",
				heading: "Daily sync",
				items: [
					{
						name: "Enable daily sync",
						desc: "Run once a day at the sync time. Connect your Google account first.",
						control: {
							type: "toggle",
							key: "enabled",
							disabled: () => !this.plugin.isConnected(),
						},
					},
					{
						name: "Sync time",
						desc: "24-hour local time, e.g. 03:00. If Obsidian is closed then, the sync runs when you next open it.",
						control: {
							type: "text",
							key: "syncTime",
							placeholder: DEFAULT_SETTINGS.syncTime,
							validate: (value) =>
								parseSyncTime(value) === null
									? "Use 24-hour HH:MM, e.g. 03:00."
									: undefined,
						},
					},
					{
						name: "Look-back days",
						desc: `How many past days each run re-checks (1–${MAX_WINDOW_DAYS}). Picks up late edits and late watch data.`,
						control: {
							type: "number",
							key: "lookBackDays",
							min: 1,
							max: MAX_WINDOW_DAYS,
							step: 1,
							validate: (value) =>
								Number.isInteger(value) && value >= 1 && value <= MAX_WINDOW_DAYS
									? undefined
									: `Enter a whole number from 1 to ${MAX_WINDOW_DAYS}.`,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Food log",
				items: [
					{
						name: "Food log path",
						desc: "Path of each day's food log. {YYYY}, {MM} and {DD} are replaced with the date.",
						control: { type: "text", key: "foodLogPath", validate: required },
					},
					{
						name: "Intake property",
						desc: "Property with the day's calories eaten. Sent to Google Health.",
						control: { type: "text", key: "intakeProperty", validate: required },
					},
					{
						name: "Burn property",
						desc: "Property the day's calories burned are written to.",
						control: { type: "text", key: "burnProperty", validate: required },
					},
					{
						name: "Carbs property",
						desc: "Only used if Google refuses an entry with calories alone.",
						control: { type: "text", key: "carbsProperty", validate: required },
					},
					{
						name: "Fat property",
						desc: "Only used if Google refuses an entry with calories alone.",
						control: { type: "text", key: "fatProperty", validate: required },
					},
				],
			},
			{
				type: "group",
				heading: "Google account",
				items: [
					{
						name: "Entry name",
						desc: "Name of the nutrition entry in Google Health. Existing entries with this name are replaced when the value changes.",
						control: { type: "text", key: "entryName", validate: required },
					},
					{
						name: "Client ID",
						desc: "OAuth client ID from Google Cloud.",
						control: { type: "text", key: "clientId" },
					},
					{
						name: "Client secret",
						desc: "OAuth client secret from Google Cloud. Stored in Obsidian's secret storage.",
						render: (setting) => this.renderClientSecret(setting),
					},
					{
						name: "Connection",
						render: (setting) =>
							this.trackDynamic(() => this.renderConnection(setting)),
					},
				],
			},
			{
				type: "group",
				heading: "Status",
				items: [
					{
						name: "Last run",
						searchable: false,
						render: (setting) => this.trackDynamic(() => this.renderStatus(setting)),
					},
				],
			},
		];
	}

	/** Renders now and on every {@link refresh} until the setting is unmounted. */
	private trackDynamic(render: () => void): () => void {
		render();
		this.dynamicRenderers.add(render);
		return () => this.dynamicRenderers.delete(render);
	}

	private renderClientSecret(setting: Setting): void {
		setting.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("Client secret")
				.setValue(this.plugin.credentials.clientSecret())
				.onChange((value) => {
					this.plugin.credentials.setClientSecret(value.trim());
					this.showSaved();
				});
		});
	}

	private renderConnection(setting: Setting): void {
		setting.controlEl.empty();
		const connected = this.plugin.isConnected();
		const state = this.plugin.state;

		const desc = createFragment((frag) => {
			if (connected) {
				frag.createDiv({ text: "Connected." });
				const missing = missingScopes(state.grantedScopes);
				for (const scope of missing) {
					frag.createDiv({
						cls: "mod-warning",
						text: `Not granted: ${SCOPE_LABELS[scope] ?? scope}. That part of the sync won't run.`,
					});
				}
				if (missing.length === 0)
					frag.createDiv({ text: "All three permissions granted." });
			} else if (state.reconnectNeeded) {
				frag.createDiv({
					cls: "mod-warning",
					text: "Reconnect needed: Google access expired or was revoked.",
				});
			} else {
				frag.createDiv({ text: "Not connected." });
			}
		});
		setting.setDesc(desc);

		if (connected) {
			setting.addButton((button) =>
				button.setButtonText("Disconnect").onClick(async () => {
					await this.plugin.disconnect();
				}),
			);
		} else {
			setting.addButton((button) =>
				button
					.setButtonText(state.reconnectNeeded ? "Reconnect" : "Connect")
					.setCta()
					.onClick(() => this.plugin.startConnect()),
			);
		}
	}

	private renderStatus(setting: Setting): void {
		const { lastRun, lastRunDate, lastProcessedDate } = this.plugin.state;
		setting.setDesc(
			createFragment((frag) => {
				if (!lastRun) {
					frag.createDiv({ text: "No runs yet." });
					return;
				}
				frag.createDiv({
					text: `Last run: ${new Date(lastRun.startedAt).toLocaleString()}`,
				});
				if (lastRunDate)
					frag.createDiv({ text: `Last completed daily run: ${lastRunDate}` });
				if (lastProcessedDate)
					frag.createDiv({ text: `Processed through: ${lastProcessedDate}` });
				if (lastRun.error) {
					frag.createDiv({ cls: "mod-warning", text: `Last error: ${lastRun.error}` });
				}
				const list = frag.createEl("ul", { cls: "google-health-sync-status" });
				for (const day of lastRun.days) {
					list.createEl("li", {
						text: `${day.date} — intake: ${describeResult(day.intake)} · burn: ${describeResult(day.burn)}`,
					});
				}
			}),
		);
	}
}

function required(value: string): string | void {
	if (!value.trim()) return "Required.";
}
