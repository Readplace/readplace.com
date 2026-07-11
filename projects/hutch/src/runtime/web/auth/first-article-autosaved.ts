import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import {
	type AnalyticsEvent,
	articleHostFrom,
	type FirstArticleAutosavedEvent,
} from "@packages/web-analytics";
import { ANALYTICS_EVENTS, STREAMS } from "../../observability/events";

/**
 * Emits the discrete `first_article_autosaved` analytics event exactly once, at
 * the post-signup redirect decision — so the activation metric is a 1:1
 * server-side count rather than a `utm_source=signup-autosave` pageview string a
 * reload or share could recount. A no-op when this signup did not auto-save
 * (explicit `?return=`, or an absent/tampered last-view cookie), so callers can
 * hand it the resolver's `autosavedUrl` unconditionally.
 */
export function emitFirstArticleAutosaved(
	deps: { logger: HutchLogger.Typed<AnalyticsEvent>; now: () => Date },
	params: { autosavedUrl: string | undefined; userId: UserId; visitorId?: string },
): void {
	if (params.autosavedUrl === undefined) return;
	const event: FirstArticleAutosavedEvent = {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.firstArticleAutosaved,
		timestamp: deps.now().toISOString(),
		user_id: params.userId,
		article_host: articleHostFrom(params.autosavedUrl),
		...(params.visitorId ? { visitor_id: params.visitorId } : {}),
	};
	deps.logger.info(event);
}
