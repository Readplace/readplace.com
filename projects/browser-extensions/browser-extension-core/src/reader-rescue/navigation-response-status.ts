export type NavigationTimeline = {
	getEntriesByType(type: string): ReadonlyArray<{ readonly entryType: string; readonly responseStatus?: number }>;
};

export function navigationResponseStatus(performance: NavigationTimeline): number | undefined {
	const [navigation] = performance.getEntriesByType("navigation");
	return navigation?.responseStatus || undefined;
}
