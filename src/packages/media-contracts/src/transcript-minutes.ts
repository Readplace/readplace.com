const MINIMUM_BILLABLE_SECONDS = 15;
const SECONDS_PER_MINUTE = 60;

export function billableSeconds(seconds: number): number {
	return Math.max(MINIMUM_BILLABLE_SECONDS, Math.ceil(seconds));
}

export function allowanceSeconds(p: { budgetMilliCents: number; milliCentsPerSecond: number }): number {
	return Math.floor(p.budgetMilliCents / p.milliCentsPerSecond);
}

export function displayMinutes(seconds: number): number {
	return Math.floor(seconds / SECONDS_PER_MINUTE);
}
