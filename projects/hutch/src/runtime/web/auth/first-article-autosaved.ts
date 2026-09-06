import type { Request } from "express";
import type { UserId } from "@packages/domain/user";
import type { ViewerIp } from "@packages/viewer-identity";
import {
	type AnalyticsEvent,
	articleHostFrom,
	type FirstArticleAutosavedEvent,
	hashIp,
	type RecordAudienceEvent,
} from "@packages/web-analytics";
import { ANALYTICS_EVENTS, STREAMS } from "../../observability/events";

/**
 * A no-op when this signup did not auto-save (explicit `?return=`, or an
 * absent/tampered last-view cookie), so callers can hand it the resolver's
 * `autosavedUrl` unconditionally. See `FirstArticleAutosavedEvent` for why the
 * discrete event exists.
 */
export function emitFirstArticleAutosaved(
	deps: { record: RecordAudienceEvent<AnalyticsEvent>; now: () => Date; salt: string },
	params: { req: Request; autosavedUrl: string | undefined; userId: UserId; visitorId?: string; ip: ViewerIp | undefined },
): void {
	if (params.autosavedUrl === undefined) return;
	const event: FirstArticleAutosavedEvent = {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.firstArticleAutosaved,
		timestamp: deps.now().toISOString(),
		user_id: params.userId,
		article_host: articleHostFrom(params.autosavedUrl),
		visitor_hash: hashIp({ ip: params.ip, salt: deps.salt }),
		...(params.visitorId ? { visitor_id: params.visitorId } : {}),
	};
	deps.record(params.req, event);
}
