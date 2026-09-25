import { PluginSettingTab, type SettingDefinitionItem } from "obsidian";

export interface GoogleHealthSyncSettings {
	/** Vault folder where synced notes are written. */
	outputFolder: string;
	/** Minutes between automatic syncs; 0 disables auto-sync. */
	syncIntervalMinutes: number;
}

type SettingKey = keyof GoogleHealthSyncSettings;

export const DEFAULT_SETTINGS: GoogleHealthSyncSettings = {
	outputFolder: "Health",
	syncIntervalMinutes: 0,
};

/**
 * Settings are declared rather than rendered imperatively, so Obsidian renders them
 * and indexes them for settings search. The base class reads from and persists to
 * `plugin.settings`.
 */
export class GoogleHealthSyncSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: "Output folder",
				desc: "Folder in your vault where synced notes are written.",
				control: {
					type: "folder",
					key: "outputFolder",
					defaultValue: DEFAULT_SETTINGS.outputFolder,
					placeholder: DEFAULT_SETTINGS.outputFolder,
				},
			},
			{
				name: "Auto-sync interval",
				desc: "Minutes between automatic syncs. Set to 0 to disable.",
				control: {
					type: "number",
					key: "syncIntervalMinutes",
					defaultValue: DEFAULT_SETTINGS.syncIntervalMinutes,
					min: 0,
					step: 1,
					validate: validateSyncInterval,
				},
			},
		];
	}
}

/** Returns an error message for an invalid interval, or nothing when it is valid. */
export function validateSyncInterval(minutes: number): string | void {
	if (!Number.isInteger(minutes) || minutes < 0) {
		return "Enter a whole number of minutes, or 0 to disable.";
	}
}
