const MINIMUM_BILLABLE_SECONDS = 15;
const SECONDS_PER_MINUTE = 60;

export function billableSeconds(seconds: number): number {
	return Math.max(MINIMUM_BILLABLE_SECONDS, Math.round(seconds));
}

export function allowanceSeconds(p: { budgetMilliCents: number; milliCentsPerSecond: number }): number {
	return Math.floor(p.budgetMilliCents / p.milliCentsPerSecond);
}

export function displayMinutes(seconds: number): number {
	return Math.floor(seconds / SECONDS_PER_MINUTE);
}

export function chargedMinutes(seconds: number): number {
	return Math.ceil(seconds / SECONDS_PER_MINUTE);
}
