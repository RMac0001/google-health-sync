/**
 * Minimal runtime stub of the "obsidian" module for unit tests.
 * The real package only provides type definitions, so anything a test
 * imports at runtime needs a stand-in here. Extend as needed.
 */

export class Notice {
	constructor(public message: string) {}
}

export class Plugin {}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
}

export class Setting {
	constructor(_containerEl: unknown) {}
}

export class App {}
