/**
 * Minimal runtime stub of the "obsidian" module for unit tests.
 * The real package only provides type definitions, so anything a test
 * imports at runtime needs a stand-in here. Extend as needed.
 */

export class Notice {
	constructor(public message: string) {}
}

export class Plugin {}

export class Modal {}

export class Setting {}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
}

export class App {}

export function debounce<T extends unknown[]>(fn: (...args: T) => unknown): (...args: T) => void {
	return (...args: T) => {
		fn(...args);
	};
}

export function normalizePath(path: string): string {
	return path;
}
