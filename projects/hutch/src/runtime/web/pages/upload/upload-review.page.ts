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
import {
	AUDIO,
	billableSeconds,
	chargedMinutes,
	displayMinutes,
	type MediaKindManifest,
	type MediaKindName,
	UploadIdSchema,
} from "@packages/media-contracts";
import { sendComponent, withInternalTracking } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import type { SettleReceivedUpload } from "./commit-received-upload";
import { defaultFileNameOf } from "./commit-received-upload";
import { redirectAnonymousToUploadSignup } from "./redirect-anonymous-to-upload-signup";
import { type UploadOutcome, type UploadOutcomeKey, writeUploadOutcome } from "./upload.outcome";
import { UPLOAD_OUTCOME_HTML } from "./upload.page";
import { UPLOAD_REFUSAL_COPY } from "./upload.refusal";
import { uploadStartPathOf } from "./upload-features";
import { kindsForViewer } from "./upload.viewmodel";
import { UploadReviewPage, type UploadReviewView } from "./upload-review.component";

export const GUEST_UPLOAD_KINDS: readonly MediaKindName[] = ["book"];
export const METERED_GUEST_UPLOAD_KINDS: readonly MediaKindName[] = ["book", "audio"];
export const METERED_ONLY_UPLOAD_KINDS: readonly MediaKindName[] = ["video"];

type ReviewViewState = "inspecting" | "ready" | "rejected";
const REVIEW_VIEW_STATES: readonly string[] = ["inspecting", "ready", "rejected"] satisfies ReviewViewState[];

type ReviewableSession = AnonymousMediaUploadSession & { readonly status: ReviewViewState };

function isReviewable(session: AnyMediaUploadSession): session is ReviewableSession {
	return REVIEW_VIEW_STATES.includes(session.status);
}

const PollSchema = z.coerce.number().int().min(0);

const REVIEW_SOURCE = "upload-review";

function uploadAgainUrlOf(session: ReviewableSession): string {
	return withInternalTracking(uploadStartPathOf(session.metered === true), {
		source: REVIEW_SOURCE,
		content: "upload-again",
	});
}

const REVIEW_VIEWS: Record<
	ReviewViewState,
	(params: {
		session: ReviewableSession;
		poll: number;
		maxPolls: number;
		transcriptAllowanceSeconds: number;
	}) => UploadReviewView
> = {
	inspecting: ({ session, poll, maxPolls }) => {
		if (poll > maxPolls) return { view: "overrun", uploadAgainUrl: uploadAgainUrlOf(session) };
		const next = `/upload/${session.uploadId}?poll=${poll + 1}`;
		return {
			view: "inspecting",
			pollUrl: next,
			checkAgainUrl: withInternalTracking(next, { source: REVIEW_SOURCE, content: "check-again" }),
		};
	},
	ready: ({ session, transcriptAllowanceSeconds }) => {
		const { facts } = session;
		assert(facts, `ready upload ${session.uploadId} has no facts`);
		const commitUrl = withInternalTracking(`/upload/${session.uploadId}/commit`, {
			source: REVIEW_SOURCE,
			content: "commit",
		});
		if (facts.kind === "book") {
			return {
				view: "review",
				title: facts.title,
				authors: facts.authors.join(", "),
				sectionTitles: facts.sectionTitles,
				commitUrl,
			};
		}
		const seconds = billableSeconds(facts.durationSeconds);
		if (seconds > transcriptAllowanceSeconds) {
			return {
				view: "too-long",
				notice: UPLOAD_REFUSAL_COPY["transcript-too-long"],
				uploadAgainUrl: uploadAgainUrlOf(session),
			};
		}
		return {
			view: "timed-review",
			heading: session.fileName ?? defaultFileNameOf(AUDIO),
			durationMinutes: displayMinutes(facts.durationSeconds),
			transcriptMinutes: chargedMinutes(seconds),
			allowanceMinutes: displayMinutes(transcriptAllowanceSeconds),
			commitUrl,
		};
	},
	rejected: ({ session }) => {
		assert(session.notice, `rejected upload ${session.uploadId} has no notice`);
		return { view: "rejected", notice: session.notice, uploadAgainUrl: uploadAgainUrlOf(session) };
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
	transcriptAllowanceSeconds: number;
	maxPolls: number;
	buildBannerState: BuildBannerState;
}): Router {
	const router = express.Router();
	async function write<K extends UploadOutcomeKey>(
		req: Request,
		res: Response,
		outcome: UploadOutcome<K>,
	) {
		const context = {
			req,
			bannerState: await deps.buildBannerState(req),
			kinds: kindsForViewer({
				kinds: deps.MEDIA_KINDS,
				guestKinds: deps.GUEST_UPLOAD_KINDS,
				isSignedIn: Boolean(req.userId),
			}),
			metered: false,
			transcriptAllowanceSeconds: deps.transcriptAllowanceSeconds,
		};
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
			transcriptAllowanceSeconds: deps.transcriptAllowanceSeconds,
		});
		const page = UploadReviewPage({
			state: view,
			uploadId: session.uploadId,
			media: session.kind === "audio" ? "audio" : "book",
		});
		sendComponent(req, res, Base(page, await deps.buildBannerState(req)));
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
			const kind = deps.MEDIA_KINDS.get(claimed.kind);
			assert(kind, `claimed upload of unknown kind ${claimed.kind}`);
			await write(
				req,
				res,
				await deps.commitReceivedUpload({
					session: claimed,
					kind,
					etag: claimed.etag,
					size: claimed.byteLength ?? 0,
				}),
			);
		},
	);

	return router;
}
