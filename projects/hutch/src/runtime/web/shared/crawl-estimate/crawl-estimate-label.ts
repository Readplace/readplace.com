export function crawlEstimateLabel(remainingSeconds: number): string {
	return remainingSeconds > 0 ? `~${remainingSeconds} s left` : "Almost there…";
}
