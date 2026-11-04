import type { RenderResourceHostBucket, RenderResourceHosts, RenderResourceRoute } from "./render-page.types";
import { siteOfHost } from "./render-site";

export type RenderRequestOutcome = { kind: "response"; status: number } | { kind: "failed" };

export type SettleRenderRequest = (outcome: RenderRequestOutcome) => void;

const IGNORE_OUTCOME: SettleRenderRequest = () => undefined;

export function createRenderResourceHosts(params: { initialHost: string; maxBuckets: number }) {
	const initialSite = siteOfHost(params.initialHost);
	let documentSite = initialSite;
	const buckets = new Map<string, RenderResourceHostBucket>();
	let overflowedRequests = 0;

	const bucketFor = (request: { requestHost: string; resourceType: string; navigation: boolean; route: RenderResourceRoute }) => {
		const key = JSON.stringify([documentSite, request.requestHost, request.resourceType, request.navigation, request.route]);
		const existing = buckets.get(key);
		if (existing !== undefined) return existing;
		if (buckets.size >= params.maxBuckets) return undefined;
		const created: RenderResourceHostBucket = { documentSite, ...request, requests: 0, response2xx: 0, responseOther: 0, failed: 0 };
		buckets.set(key, created);
		return created;
	};

	return {
		enterDocument: (hostname: string) => {
			documentSite = siteOfHost(hostname);
		},
		record: (request: { requestHost: string; resourceType: string; navigation: boolean; route: RenderResourceRoute }): SettleRenderRequest => {
			const bucket = bucketFor(request);
			if (bucket === undefined) {
				overflowedRequests += 1;
				return IGNORE_OUTCOME;
			}
			bucket.requests += 1;
			let settled = false;
			return (outcome) => {
				if (settled) return;
				settled = true;
				if (outcome.kind === "failed") bucket.failed += 1;
				else if (outcome.status >= 200 && outcome.status < 300) bucket.response2xx += 1;
				else bucket.responseOther += 1;
			};
		},
		snapshot: (): RenderResourceHosts => ({
			initialSite,
			finalSite: documentSite,
			buckets: [...buckets.values()].map((bucket) => ({ ...bucket })),
			overflowedRequests,
		}),
	};
}
