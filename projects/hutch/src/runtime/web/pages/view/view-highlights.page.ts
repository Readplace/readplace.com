import assert from "node:assert";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import {
	HIGHLIGHT_CONTEXT_LENGTH,
	VIEW_HIGHLIGHT_LIMIT,
	VIEW_HIGHLIGHT_MAX_TEXT_LENGTH,
} from "@packages/domain/article/highlight";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { viewerOf } from "@packages/viewer-identity";
import { type AnalyticsEvent, defineCookie, hashIp, type RecordAudienceEvent } from "@packages/web-analytics";
import { requireCspNonce, sendComponent } from "@packages/web-shell";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
import {
	type FindPendingViewHighlights,
	PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS,
	type ReleasePendingViewHighlights,
	type StorePendingViewHighlights,
} from "../../../providers/pending-view-highlights/pending-view-highlights.types";
import { extractReturnUrl } from "../../auth/parse-return-url";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { createRateLimitMiddleware } from "../../middleware/rate-limit";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { resolveSaveProvenance } from "../../shared/save-provenance";
import { highlightReaderLocation } from "../readlist/highlight-surface";
import type { ClaimViewHighlights } from "./claim-view-highlights";
import { ViewHighlightsClaimPage } from "./view-highlights-claim.component";
import {
	VIEW_HIGHLIGHTS_CLAIM_PATH,
	VIEW_HIGHLIGHTS_CLAIM_ROUTE,
	VIEW_HIGHLIGHTS_EVENT_ROUTE,
	VIEW_HIGHLIGHTS_KEEP_ROUTE,
} from "./view-highlights-paths";

export const PENDING_VIEW_HIGHLIGHTS_COOKIE_NAME = "hutch_phid";

const pendingViewHighlightsCookie = defineCookie({
	name: PENDING_VIEW_HIGHLIGHTS_COOKIE_NAME,
	maxAgeMs: PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS * 1000,
	sameSite: "lax",
	httpOnly: true,
	schema: z.uuid(),
});

const KeptHighlightSchema = z.object({
	url: z.string(),
	exact: z.string().min(1).max(VIEW_HIGHLIGHT_MAX_TEXT_LENGTH),
	prefix: z.string().max(HIGHLIGHT_CONTEXT_LENGTH),
	suffix: z.string().max(HIGHLIGHT_CONTEXT_LENGTH),
	note: z.string().max(VIEW_HIGHLIGHT_MAX_TEXT_LENGTH).optional(),
});

const KeepBodySchema = z.object({
	highlights: z
		.string()
		.transform((raw, context) => {
			try {
				return JSON.parse(raw);
			} catch {
				context.addIssue({ code: "custom", message: "highlights must be JSON" });
				return z.NEVER;
			}
		})
		.pipe(z.array(KeptHighlightSchema).min(1).max(VIEW_HIGHLIGHT_LIMIT)),
	article: z.string(),
	intent: z.enum(["signup", "login"]),
	return: z.string().optional(),
});

const EventQuerySchema = z.union([
	z.object({ action: z.enum(["kept", "limit-reached"]) }),
	z.object({ origin: z.literal("mark") }),
]);

const EVENT_ACTIONS = { kept: "kept", "limit-reached": "limit_reached" } as const;

function claimedLocation(articleId: string | undefined): string {
	return articleId === undefined
		? "/queue"
		: highlightReaderLocation({ articleId, readlist: [], surface: [], fragment: "rail" });
}

export function initViewHighlightsRoutes(deps: {
	appOrigin: string;
	validateSaveableUrl: ValidateSaveableUrl;
	storePendingViewHighlights: StorePendingViewHighlights;
	findPendingViewHighlights: FindPendingViewHighlights;
	releasePendingViewHighlights: ReleasePendingViewHighlights;
	claimViewHighlights: ClaimViewHighlights;
	generatePendingId: () => string;
	secureCookies: boolean;
	consumeRateLimit: ConsumeRateLimit;
	keepRateLimitRule: RateLimitRule;
	buildBannerState: BuildBannerState;
	recordAnalyticsEvent: RecordAudienceEvent<AnalyticsEvent>;
	salt: string;
	now: () => Date;
}): Router {
	const router = express.Router();
	const signupForClaim = `/signup?return=${encodeURIComponent(VIEW_HIGHLIGHTS_CLAIM_PATH)}`;
	const visitorHash = (req: Request) => hashIp({ ip: viewerOf(req).ip, salt: deps.salt });
	const visitorIdOf = (req: Request): string => {
		assert(req.visitorId, "visitor-id middleware must run before the view highlights routes");
		return req.visitorId;
	};

	const keepRateLimit = createRateLimitMiddleware({
		consumeRateLimit: deps.consumeRateLimit,
		bucket: "view-highlights-keep",
		rule: deps.keepRateLimitRule,
	});

	router.post(
		VIEW_HIGHLIGHTS_KEEP_ROUTE,
		keepRateLimit,
		async (req: Request, res: Response) => {
			if (req.userId !== undefined) {
				res.redirect(303, "/queue");
				return;
			}
			const body = KeepBodySchema.safeParse(req.body);
			const urls = body.success ? [body.data.article, ...body.data.highlights.map((item) => item.url)] : [];
			const validUrls = urls.map((url) => deps.validateSaveableUrl(url));
			if (!body.success || validUrls.some((validation) => validation.status === "ERROR")) {
				res.status(400).type("html").send("");
				return;
			}
			const pendingId = deps.generatePendingId();
			await deps.storePendingViewHighlights({
				pendingId,
				articleUrl: body.data.article,
				items: body.data.highlights,
				returnTo: extractReturnUrl({ return: body.data.return }),
			});
			pendingViewHighlightsCookie.set({ res, value: pendingId, secure: deps.secureCookies });
			deps.recordAnalyticsEvent(req, {
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.viewHighlightsHandedOver,
				timestamp: deps.now().toISOString(),
				intent: body.data.intent,
				highlights: body.data.highlights.length,
				visitor_hash: visitorHash(req),
				visitor_id: visitorIdOf(req),
			});
			const authPath = body.data.intent === "login" ? "/login" : "/signup";
			res.redirect(303, `${authPath}?return=${encodeURIComponent(VIEW_HIGHLIGHTS_CLAIM_PATH)}`);
		},
	);

	router.post(VIEW_HIGHLIGHTS_EVENT_ROUTE, (req: Request, res: Response) => {
		const query = EventQuerySchema.safeParse(req.query);
		if (query.success) {
			deps.recordAnalyticsEvent(req, {
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.viewHighlight,
				timestamp: deps.now().toISOString(),
				action: "action" in query.data ? EVENT_ACTIONS[query.data.action] : "opened",
				visitor_hash: visitorHash(req),
				visitor_id: visitorIdOf(req),
			});
		}
		res.status(204).end();
	});

	const requireSessionForClaim: RequestHandler = (req, res, next) => {
		if (req.userId === undefined) {
			res.redirect(303, signupForClaim);
			return;
		}
		if (pendingViewHighlightsCookie.read(req) === undefined) {
			res.redirect(303, "/queue");
			return;
		}
		next();
	};

	router.get(VIEW_HIGHLIGHTS_CLAIM_ROUTE, requireSessionForClaim, async (req: Request, res: Response) => {
		sendComponent(
			req,
			res,
			Base(
				ViewHighlightsClaimPage({ appOrigin: deps.appOrigin, cspNonce: requireCspNonce(req) }),
				await deps.buildBannerState(req),
			),
		);
	});

	router.post(
		VIEW_HIGHLIGHTS_CLAIM_ROUTE,
		requireSessionForClaim,
		requireNotLocked,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireSessionForClaim");
			const pendingId = pendingViewHighlightsCookie.read(req);
			assert(pendingId, "the claim gate only lets a request with a pending id through");
			const pending = await deps.findPendingViewHighlights(pendingId);
			if (pending === undefined) {
				pendingViewHighlightsCookie.consume({ req, res });
				res.redirect(303, "/queue");
				return;
			}
			const claimed = await deps.claimViewHighlights({
				userId: req.userId,
				provenance: resolveSaveProvenance(req.oauthClientId),
				pending,
			});
			await deps.releasePendingViewHighlights(pendingId);
			pendingViewHighlightsCookie.consume({ req, res });
			deps.recordAnalyticsEvent(req, {
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.viewHighlightsClaimed,
				timestamp: deps.now().toISOString(),
				user_id: req.userId,
				created: claimed.created,
				dropped: claimed.dropped,
				visitor_hash: visitorHash(req),
			});
			res.redirect(303, pending.returnTo ?? claimedLocation(claimed.articleId));
		},
	);

	return router;
}
