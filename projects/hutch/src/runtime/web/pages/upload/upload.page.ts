import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { newSaveAttemptId } from "@packages/domain/article";
import type {
	CreateMediaUploadSession,
	FindMediaUploadSession,
	HeadMediaPendingOriginal,
	MediaUploadSessionState,
	MintMediaPendingPost,
	ReadMediaPendingPrefix,
} from "@packages/domain";
import { type MediaKindManifest, type MediaKindName, type UploadId, UploadIdSchema } from "@packages/media-contracts";
import { sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { SettleReceivedUpload } from "./commit-received-upload";
import { UploadPage } from "./upload.component";
import { UPLOAD_ERROR_STATUS, type UploadErrorCode } from "./upload.error";
import {
	type UploadOutcome,
	type UploadOutcomeKey,
	type UploadOutcomeWriters,
	type UploadWriteContext,
	writeUploadOutcome,
} from "./upload.outcome";
import { acceptAttributeOf, toUploadStartViewModel } from "./upload.viewmodel";

const SNIFF_BYTES = 4096;

type UploadSessionViewState = "staged" | "committed" | "failed";
const UPLOAD_SESSION_VIEW_STATES: readonly string[] = ["staged", "committed", "failed"] satisfies UploadSessionViewState[];

function isUploadSessionViewState(state: MediaUploadSessionState): state is UploadSessionViewState {
	return UPLOAD_SESSION_VIEW_STATES.includes(state);
}

const StartUploadBody = z.object({
	contentType: z.string().min(1),
	fileName: z.string().min(1).optional(),
	byteLength: z.coerce.number().int().positive().optional(),
});

function sendPage(context: UploadWriteContext, res: Response, page: ReturnType<typeof UploadPage>): void {
	sendComponent(context.req, res, Base(page, context.bannerState));
}

function errorWriter(code: UploadErrorCode): (res: Response, _outcome: unknown, context: UploadWriteContext) => void {
	return (res, _outcome, context) => {
		sendPage(context, res, {
			...UploadPage({ view: "start", start: toUploadStartViewModel(context.kinds), errorCode: code }),
			statusCode: UPLOAD_ERROR_STATUS[code],
		});
	};
}

export const UPLOAD_OUTCOME_HTML: UploadOutcomeWriters = {
	staged: (res, outcome, context) => {
		const kind = context.kinds.get(outcome.kind);
		assert(kind, `staged upload of unknown kind ${outcome.kind}`);
		sendPage(
			context,
			res,
			UploadPage({
				view: "staged",
				staged: {
					url: outcome.post.url,
					fields: Object.entries(outcome.post.fields).map(([name, value]) => ({ name, value })),
					ceilingLabel: kind.ceilingLabel,
					accept: acceptAttributeOf(kind),
				},
			}),
		);
	},
	committed: (res) => {
		res.redirect(303, "/queue");
	},
	continue: (res, outcome, context) => {
		sendPage(context, res, UploadPage({ view: "continue", uploadId: outcome.uploadId }));
	},
	failed: (res, _outcome, context) => {
		sendPage(context, res, UploadPage({ view: "failed" }));
	},
	upload_unsupported_type: errorWriter("upload_unsupported_type"),
	upload_too_large: errorWriter("upload_too_large"),
	upload_not_received: errorWriter("upload_not_received"),
	upload_bad_magic: errorWriter("upload_bad_magic"),
	upload_session_not_found: errorWriter("upload_session_not_found"),
};

function kindAccepting(
	kinds: ReadonlyMap<MediaKindName, MediaKindManifest>,
	contentType: string,
): MediaKindManifest | undefined {
	return [...kinds.values()].find((kind) => contentType in kind.accepts);
}

export interface UploadRouteDependencies {
	stageGates: readonly RequestHandler[];
	settleReceivedUpload: SettleReceivedUpload;
	createMediaUploadSession: CreateMediaUploadSession;
	findMediaUploadSession: FindMediaUploadSession;
	mintMediaPendingPost: MintMediaPendingPost;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
	mintUploadId: () => UploadId;
	MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest>;
	pickOutcomeWriters: (req: Request) => UploadOutcomeWriters;
	buildBannerState: BuildBannerState;
	appOrigin: string;
}

export function initUploadRouter(deps: UploadRouteDependencies): Router {
	const router = express.Router();
	const kinds = deps.MEDIA_KINDS;

	async function write<K extends UploadOutcomeKey>(req: Request, res: Response, outcome: UploadOutcome<K>) {
		const context: UploadWriteContext = { req, bannerState: await deps.buildBannerState(req), kinds };
		writeUploadOutcome({ writers: deps.pickOutcomeWriters(req), res, outcome, context });
	}

	router.get("/", async (req, res) => {
		sendComponent(
			req,
			res,
			Base(UploadPage({ view: "start", start: toUploadStartViewModel(kinds) }), await deps.buildBannerState(req)),
		);
	});

	router.post("/", ...deps.stageGates, async (req, res) => {
		const userId = req.userId;
		assert(userId, "the stage gates admit only a signed-in reader");
		const body = StartUploadBody.safeParse(req.body);
		const kind = body.success ? kindAccepting(kinds, body.data.contentType) : undefined;
		if (!body.success || !kind) {
			await write(req, res, { outcome: "upload_unsupported_type" });
			return;
		}
		const { contentType, fileName, byteLength } = body.data;
		if (byteLength !== undefined && byteLength > kind.uploadCeilingBytes) {
			await write(req, res, { outcome: "upload_too_large" });
			return;
		}
		const uploadId = deps.mintUploadId();
		await deps.createMediaUploadSession({
			uploadId,
			userId,
			kind: kind.name,
			fileName: fileName ?? `${kind.label} upload`,
			...(byteLength === undefined ? {} : { byteLength }),
			saveAttemptId: newSaveAttemptId(),
		});
		const post = await deps.mintMediaPendingPost({
			uploadId,
			contentType,
			uploadCeilingBytes: kind.uploadCeilingBytes,
			successActionRedirect: `${deps.appOrigin}/upload/${uploadId}`,
		});
		await write(req, res, {
			outcome: "staged",
			uploadId,
			kind: kind.name,
			post,
			uploadCeilingBytes: kind.uploadCeilingBytes,
		});
	});

	async function findOwnSession(req: Request) {
		const uploadId = UploadIdSchema.safeParse(req.params.id);
		if (!uploadId.success || !req.userId) return undefined;
		return deps.findMediaUploadSession({ uploadId: uploadId.data, userId: req.userId });
	}

	router.get("/:id", async (req, res) => {
		const session = await findOwnSession(req);
		if (!session) {
			await write(req, res, { outcome: "upload_session_not_found" });
			return;
		}
		assert(isUploadSessionViewState(session.status), `no upload view for ${session.status}`);
		const views: Record<UploadSessionViewState, UploadOutcome> = {
			staged: { outcome: "continue", uploadId: session.uploadId },
			committed: { outcome: "committed", uploadId: session.uploadId },
			failed: { outcome: "failed", uploadId: session.uploadId },
		};
		await write(req, res, views[session.status]);
	});

	router.post("/:id/received", ...deps.stageGates, async (req, res) => {
		const session = await findOwnSession(req);
		if (!session) {
			await write(req, res, { outcome: "upload_session_not_found" });
			return;
		}
		if (session.status !== "staged") {
			await write(req, res, { outcome: session.status, uploadId: session.uploadId });
			return;
		}
		const head = await deps.headMediaPendingOriginal({ uploadId: session.uploadId });
		if (!head) {
			await write(req, res, { outcome: "upload_not_received" });
			return;
		}
		const kind = kinds.get(session.kind);
		assert(kind, `upload session of unknown kind ${session.kind}`);
		const prefix = await deps.readMediaPendingPrefix({ uploadId: session.uploadId, etag: head.etag, bytes: SNIFF_BYTES });
		if (!kind.sniff(prefix)) {
			await write(req, res, { outcome: "upload_bad_magic" });
			return;
		}
		await write(req, res, await deps.settleReceivedUpload({ session, etag: head.etag, size: head.size }));
	});

	return router;
}
