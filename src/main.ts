import { Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	GoogleHealthSyncSettingTab,
	type GoogleHealthSyncSettings,
} from "./settings";

export default class GoogleHealthSyncPlugin extends Plugin {
	settings: GoogleHealthSyncSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: () => this.sync(),
		});

		this.addSettingTab(new GoogleHealthSyncSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<GoogleHealthSyncSettings> | null,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private sync(): void {
		// Placeholder until the Google Health API client is implemented.
		new Notice("Sync is not implemented yet.");
	}
}
