import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type {
	AnonymousMediaUploadSession,
	AnyMediaUploadSession,
	ClaimMediaUpload,
	FindMediaUploadByCapability,
} from "@packages/domain";
import { type MediaKindManifest, type MediaKindName, UploadIdSchema } from "@packages/media-contracts";
import { sendComponent, withInternalTracking } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import type { SettleReceivedUpload } from "./commit-received-upload";
import { redirectAnonymousToUploadSignup } from "./redirect-anonymous-to-upload-signup";
import { type UploadReviewView, UploadReviewPage } from "./upload-review.component";
import { type UploadOutcome, type UploadOutcomeKey, writeUploadOutcome } from "./upload.outcome";
import { StartUploadBody, UPLOAD_OUTCOME_HTML, kindAccepting } from "./upload.page";

export const GUEST_UPLOAD_KINDS: readonly MediaKindName[] = ["book"];

type ReviewViewState = "inspecting" | "ready" | "rejected";
const REVIEW_VIEW_STATES: readonly string[] = ["inspecting", "ready", "rejected"] satisfies ReviewViewState[];

type ReviewableSession = AnonymousMediaUploadSession & { readonly status: ReviewViewState };

function isReviewable(session: AnyMediaUploadSession): session is ReviewableSession {
	return REVIEW_VIEW_STATES.includes(session.status);
}

const PollSchema = z.coerce.number().int().min(0);

const REVIEW_SOURCE = "upload-review";

const REVIEW_VIEWS: Record<
	ReviewViewState,
	(params: { session: ReviewableSession; poll: number; maxPolls: number }) => UploadReviewView
> = {
	inspecting: ({ session, poll, maxPolls }) => {
		if (poll > maxPolls) return { view: "overrun" };
		const next = `/upload/${session.uploadId}?poll=${poll + 1}`;
		return {
			view: "inspecting",
			pollUrl: next,
			checkAgainUrl: withInternalTracking(next, { source: REVIEW_SOURCE, content: "check-again" }),
		};
	},
	ready: ({ session }) => {
		assert(session.facts, `ready upload ${session.uploadId} has no facts`);
		return {
			view: "review",
			title: session.facts.title,
			authors: session.facts.authors.join(", "),
			sectionTitles: session.facts.sectionTitles,
			commitUrl: withInternalTracking(`/upload/${session.uploadId}/commit`, { source: REVIEW_SOURCE, content: "commit" }),
		};
	},
	rejected: ({ session }) => {
		assert(session.notice, `rejected upload ${session.uploadId} has no notice`);
		return { view: "rejected", notice: session.notice };
	},
};

export function initAnonymousUploadRoutes(deps: {
	findMediaUploadByCapability: FindMediaUploadByCapability;
	claimMediaUpload: ClaimMediaUpload;
	commitReceivedUpload: SettleReceivedUpload;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	GUEST_UPLOAD_KINDS: readonly MediaKindName[];
	MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest>;
	maxPolls: number;
	buildBannerState: BuildBannerState;
}): Router {
	const router = express.Router();
	const kinds = deps.MEDIA_KINDS;

	async function write<K extends UploadOutcomeKey>(req: Request, res: Response, outcome: UploadOutcome<K>) {
		const context = { req, bannerState: await deps.buildBannerState(req), kinds };
		writeUploadOutcome({ writers: UPLOAD_OUTCOME_HTML, res, outcome, context });
	}

	async function findByCapability(req: Request) {
		const uploadId = UploadIdSchema.safeParse(req.params.id);
		if (!uploadId.success) return undefined;
		return deps.findMediaUploadByCapability({ uploadId: uploadId.data, userId: req.userId });
	}

	router.get("/:id", noindexMiddleware, async (req, res, next) => {
		const session = await findByCapability(req);
		if (!session || !isReviewable(session)) {
			next();
			return;
		}
		const poll = PollSchema.safeParse(req.query.poll);
		const view = REVIEW_VIEWS[session.status]({
			session,
			poll: poll.success ? poll.data : 0,
			maxPolls: deps.maxPolls,
		});
		sendComponent(req, res, Base(UploadReviewPage({ state: view, uploadId: session.uploadId }), await deps.buildBannerState(req)));
	});

	router.post("/", async (req, res, next) => {
		const body = StartUploadBody.safeParse(req.body);
		const kind = body.success ? kindAccepting(kinds, body.data.contentType) : undefined;
		if (req.userId || !kind || deps.GUEST_UPLOAD_KINDS.includes(kind.name)) {
			next();
			return;
		}
		await write(req, res, { outcome: "upload_unsupported_type" });
	});

	router.post(
		"/:id/commit",
		redirectAnonymousToUploadSignup,
		deps.requireNotLocked,
		deps.requireWriteAccess,
		async (req, res) => {
			const userId = req.userId;
			assert(userId, "redirectAnonymousToUploadSignup admits only a signed-in reader");
			const session = await findByCapability(req);
			if (!session) {
				await write(req, res, { outcome: "upload_session_not_found" });
				return;
			}
			if (session.status === "committed") {
				await write(req, res, { outcome: "committed", uploadId: session.uploadId });
				return;
			}
			const claimed = await deps.claimMediaUpload({ uploadId: session.uploadId, userId });
			if (claimed === "not-claimable") {
				await write(req, res, { outcome: "upload_session_not_found" });
				return;
			}
			await write(
				req,
				res,
				await deps.commitReceivedUpload({ session: claimed, etag: claimed.etag, size: claimed.byteLength ?? 0 }),
			);
		},
	);

	return router;
}
