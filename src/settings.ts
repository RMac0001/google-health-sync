import { App, PluginSettingTab, Setting } from "obsidian";
import type GoogleHealthSyncPlugin from "./main";

export interface GoogleHealthSyncSettings {
	/** Vault folder where synced notes are written. */
	outputFolder: string;
	/** Minutes between automatic syncs; 0 disables auto-sync. */
	syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: GoogleHealthSyncSettings = {
	outputFolder: "Health",
	syncIntervalMinutes: 0,
};

export class GoogleHealthSyncSettingTab extends PluginSettingTab {
	plugin: GoogleHealthSyncPlugin;

	constructor(app: App, plugin: GoogleHealthSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder in your vault where synced notes are written.")
			.addText((text) =>
				text
					.setPlaceholder("Health")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-sync interval")
			.setDesc("Minutes between automatic syncs. Set to 0 to disable.")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						this.plugin.settings.syncIntervalMinutes = parseSyncInterval(value);
						await this.plugin.saveSettings();
					}),
			);
	}
}

/** Parses a user-entered interval, falling back to 0 (disabled) for invalid input. */
export function parseSyncInterval(value: string): number {
	const minutes = Number.parseInt(value, 10);
	return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}
