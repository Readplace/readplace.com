export const RENDER_CRAWL_TIMEOUTS = {
	lambdaSeconds: 420,
	sqsVisibilitySeconds: 600,
	directNavigationMs: 30_000,
	residentialNavigationMs: 30_000,
	webUnlockerNavigationMs: 90_000,
	renderOverheadMs: 25_000,
	webUnlockerFetch: { headersMs: 100_000, bodyMs: 180_000 },
	finalizationReserveMs: 30_000,
} as const;
