/**
 * Pure, browser-and-node-safe instant formatting shared by the SSR view-models
 * and the `local-time.client.ts` enhancer. The server renders a UTC-labelled
 * baseline so the value is unambiguous without JavaScript; the client re-runs
 * the same formatter with the browser's resolved zone to localise it.
 */

export type LocalTimeMode = "datetime" | "date" | "relative";

/** The view-model → template contract for a single stored instant. The template
 * renders one uniform `<time datetime="{{iso}}" data-local-time="{{mode}}">` */
export interface LocalTime {
	iso: string;
	label: string;
	mode: LocalTimeMode;
}

export type LocalTimeStyle = "datetime" | "date";

export const LOCALE = "en-US";

/** Explicit component options rather than dateStyle/timeStyle, which cannot be
 * combined with timeZoneName. hour12:false yields a 24-hour clock (09:00, not
 * 9:00 am); timeZoneName:"short" yields the abbreviation (UTC, EDT) and
 * auto-falls back to a GMT offset (GMT+5:30) for zones without one. */
const DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZoneName: "short",
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
};

export function formatLocalInstant(input: {
	iso: string;
	style: LocalTimeStyle;
	timeZone: string;
}): string {
	const base = input.style === "datetime" ? DATETIME_OPTIONS : DATE_OPTIONS;
	return new Date(input.iso).toLocaleString(LOCALE, { ...base, timeZone: input.timeZone });
}

export function toAbsoluteDateTime(input: { iso: string }): LocalTime {
	return {
		iso: input.iso,
		label: formatLocalInstant({ iso: input.iso, style: "datetime", timeZone: "UTC" }),
		mode: "datetime",
	};
}

export function toAbsoluteDate(input: { iso: string }): LocalTime {
	return {
		iso: input.iso,
		label: formatLocalInstant({ iso: input.iso, style: "date", timeZone: "UTC" }),
		mode: "date",
	};
}

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;
const RELATIVE_DAYS_CUTOFF = 30;

/** Recent instants render as a timezone-neutral relative string ("5m ago");
 * once past the cutoff they fall back to an absolute calendar date so the row
 * still reads sensibly. Consolidates the relative-time logic that was
 * duplicated across the inbox list and the queue. */
export function toRelativeOrDate(input: { iso: string; now: Date }): LocalTime {
	const { iso, now } = input;
	const diffMs = now.getTime() - new Date(iso).getTime();
	const diffMinutes = Math.floor(diffMs / ONE_MINUTE_MS);
	const diffHours = Math.floor(diffMs / ONE_HOUR_MS);
	const diffDays = Math.floor(diffMs / ONE_DAY_MS);

	if (diffMinutes < 1) return { iso, label: "just now", mode: "relative" };
	if (diffMinutes < 60) return { iso, label: `${diffMinutes}m ago`, mode: "relative" };
	if (diffHours < 24) return { iso, label: `${diffHours}h ago`, mode: "relative" };
	if (diffDays < RELATIVE_DAYS_CUTOFF)
		return { iso, label: `${diffDays}d ago`, mode: "relative" };
	return toAbsoluteDate({ iso });
}
