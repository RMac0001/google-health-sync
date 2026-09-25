import { formatLocalDate, parseSyncTime } from "./dates";

/** Minimum wait between attempts after a failed run. */
export const RETRY_DELAY_MS = 15 * 60_000;

export interface ScheduleInput {
	enabled: boolean;
	connected: boolean;
	running: boolean;
	syncTime: string;
	lastRunDate?: string;
	lastAttemptAt?: number;
}

/**
 * Whether the scheduled daily run should start now: enabled, connected, not already running,
 * at or past the sync time, not yet completed today, and not retried within the last 15 min.
 */
export function isSyncDue(now: Date, input: ScheduleInput): boolean {
	if (!input.enabled || !input.connected || input.running) return false;
	const syncMinutes = parseSyncTime(input.syncTime);
	if (syncMinutes === null) return false;
	if (now.getHours() * 60 + now.getMinutes() < syncMinutes) return false;
	if (input.lastRunDate === formatLocalDate(now)) return false;
	if (input.lastAttemptAt !== undefined && now.getTime() - input.lastAttemptAt < RETRY_DELAY_MS) {
		return false;
	}
	return true;
}
