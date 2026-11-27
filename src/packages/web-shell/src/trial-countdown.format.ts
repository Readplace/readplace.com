export interface TrialRemaining {
	days: number;
	hours: number;
	minutes: number;
}

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export function formatTrialRemaining(
	endsAtIso: string,
	now: Date,
): TrialRemaining {
	const endsAtMs = Date.parse(endsAtIso);
	const totalMs = Math.max(0, endsAtMs - now.getTime());
	const days = Math.floor(totalMs / ONE_DAY_MS);
	const hours = Math.floor((totalMs % ONE_DAY_MS) / ONE_HOUR_MS);
	const minutes = Math.floor((totalMs % ONE_HOUR_MS) / ONE_MINUTE_MS);
	return { days, hours, minutes };
}
