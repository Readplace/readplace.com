import { ALL_READLIST_PATH } from "../readlist/readlist.url";
import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { newSaveAttemptId } from "@packages/domain/article";
import type {
	AnyMediaUploadSession,
	CreateAnyMediaUploadSession,
	FindMediaUploadByCapability,
	HeadMediaPendingOriginal,
	MediaPendingSuccessAction,
	MintMediaPendingPost,
	ReadMediaPendingPrefix,
} from "@packages/domain";
import { type MediaKindManifest, type MediaKindName, type UploadId, UploadIdSchema } from "@packages/media-contracts";
import type { Logger } from "@packages/logger";
import { sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { SettleAnyReceivedUpload } from "./commit-received-upload";
import { UploadPage } from "./upload.component";
import { UPLOAD_ERROR_STATUS, type UploadErrorCode, uploadErrorMessageOf } from "./upload.error";
import {
	type UploadOutcome,
	type UploadOutcomeKey,
	type UploadOutcomeWriters,
	type UploadWriteContext,
	writeUploadOutcome,
} from "./upload.outcome";
import { type TranscriptRefusalReason, bookQuotaRedirectQueryOf, uploadRefusalOf } from "./upload.refusal";
import {
	acceptAttributeOf,
	detectUploadKind,
	kindsForViewer,
	toUploadStartViewModel,
	transcriptAllowanceOf,
} from "./upload.viewmodel";

const SNIFF_BYTES = 4096;

type UploadSessionViewState = "staged" | "committed" | "failed";
const UPLOAD_SESSION_VIEW_STATES: readonly string[] = ["staged", "committed", "failed"] satisfies UploadSessionViewState[];

function isUploadSessionViewState(state: AnyMediaUploadSession["status"]): state is UploadSessionViewState {
	return UPLOAD_SESSION_VIEW_STATES.includes(state);
}

const RECEIVED_AGAIN: Record<
	Exclude<AnyMediaUploadSession["status"], "staged">,
	"committed" | "failed" | "staged-for-review"
> = {
	committed: "committed",
	failed: "failed",
	inspecting: "staged-for-review",
	ready: "staged-for-review",
	rejected: "staged-for-review",
};

const LOGGED_EXTENSION_MAX_LENGTH = 16;

function refusedExtension(fileName: string | undefined): string | null {
	if (fileName === undefined) return null;
	const dot = fileName.lastIndexOf(".");
	return dot === -1 ? "" : fileName.slice(dot, dot + LOGGED_EXTENSION_MAX_LENGTH).toLowerCase();
}

const StartUploadBody = z.object({
	fileName: z.string().min(1).optional(),
	byteLength: z.coerce.number().int().positive().optional(),
});

function sendPage(context: UploadWriteContext, res: Response, page: ReturnType<typeof UploadPage>): void {
	sendComponent(context.req, res, Base(page, context.bannerState));
}

function errorWriter(code: UploadErrorCode): (res: Response, _outcome: unknown, context: UploadWriteContext) => void {
	return (res, _outcome, context) => {
		sendPage(context, res, {
			...UploadPage({
				view: "start",
				start: {
					...toUploadStartViewModel(
						context.kinds,
						Boolean(context.req.userId),
						"/upload",
					),
					transcriptAllowance: transcriptAllowanceOf({
						kinds: context.kinds,
						allowanceSeconds: context.transcriptAllowanceSeconds,
					}),
				},
				error: {
					code,
					message: uploadErrorMessageOf({ code, kinds: context.kinds }),
				},
			}),
			statusCode: UPLOAD_ERROR_STATUS[code],
		});
	};
}

function refusalWriter(reason: TranscriptRefusalReason): (res: Response) => void {
	return (res) => {
		res.redirect(303, `/upload?refused=${reason}`);
	};
}

export const UPLOAD_OUTCOME_HTML: UploadOutcomeWriters = {
	staged: (res, outcome, context) => {
		const start = toUploadStartViewModel(
			context.kinds,
			Boolean(context.req.userId),
			"/upload",
		);
		sendPage(
			context,
			res,
			UploadPage({
				view: "staged",
				staged: {
					url: outcome.post.url,
					fields: Object.entries(outcome.post.fields).map(([name, value]) => ({
						name,
						value,
					})),
					heading: start.heading,
					descriptions: start.descriptions,
					accept: acceptAttributeOf(context.kinds),
				},
			}),
		);
	},
	committed: (res) => {
		res.redirect(303, ALL_READLIST_PATH);
	},
	"staged-for-review": (res, outcome) => {
		res.redirect(303, `/upload/${outcome.uploadId}`);
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
	upload_session_not_found: errorWriter("upload_session_not_found"),
	"transcript-quota": refusalWriter("transcript-quota"),
	"transcript-too-long": refusalWriter("transcript-too-long"),
	"unreadable-audio": refusalWriter("unreadable-audio"),
	"no-audio-track": refusalWriter("no-audio-track"),
	"book-quota": (res, outcome) => {
		res.redirect(303, `/upload?${bookQuotaRedirectQueryOf(outcome.retryAt)}`);
	},
};

function writeStartPage(res: Response, context: UploadWriteContext): void {
	sendPage(
		context,
		res,
		UploadPage({
			view: "start",
			start: {
				...toUploadStartViewModel(context.kinds, Boolean(context.req.userId), "/upload"),
				refusal: uploadRefusalOf({
					query: context.req.query,
					allowanceSeconds: context.transcriptAllowanceSeconds,
				}),
				transcriptAllowance: transcriptAllowanceOf({
					kinds: context.kinds,
					allowanceSeconds: context.transcriptAllowanceSeconds,
				}),
			},
		}),
	);
}

export type UploadProtocol = {
	start: (res: Response, context: UploadWriteContext) => void;
	writers: UploadOutcomeWriters;
	s3SuccessAction: (continueUrl: string) => MediaPendingSuccessAction;
};

export const UPLOAD_PROTOCOL_HTML: UploadProtocol = {
	start: writeStartPage,
	writers: UPLOAD_OUTCOME_HTML,
	s3SuccessAction: (continueUrl) => ({ redirect: continueUrl }),
};

export interface UploadRouteDependencies {
	stageGates: readonly RequestHandler[];
	settleReceivedUpload: SettleAnyReceivedUpload;
	createMediaUploadSession: CreateAnyMediaUploadSession;
	findMediaUploadSession: FindMediaUploadByCapability;
	mintMediaPendingPost: MintMediaPendingPost;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
	mintUploadId: () => UploadId;
	MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest>;
	GUEST_UPLOAD_KINDS: readonly MediaKindName[];
	transcriptAllowanceSeconds: number;
	pickUploadProtocol: (req: Request) => UploadProtocol;
	buildBannerState: BuildBannerState;
	appOrigin: string;
	logger: Logger;
}

export function initUploadRouter(deps: UploadRouteDependencies): Router {
	const router = express.Router();
	const viewerKinds = (req: Request) =>
		kindsForViewer({
			kinds: deps.MEDIA_KINDS,
			guestKinds: deps.GUEST_UPLOAD_KINDS,
			isSignedIn: Boolean(req.userId),
		});

	async function contextOf(req: Request): Promise<UploadWriteContext> {
		return {
			req,
			bannerState: await deps.buildBannerState(req),
			kinds: viewerKinds(req),
			transcriptAllowanceSeconds: deps.transcriptAllowanceSeconds,
		};
	}

	async function write<K extends UploadOutcomeKey>(
		req: Request,
		res: Response,
		outcome: UploadOutcome<K>,
	) {
		writeUploadOutcome({
			writers: deps.pickUploadProtocol(req).writers,
			res,
			outcome,
			context: await contextOf(req),
		});
	}

	router.get("/", async (req, res) => {
		deps.pickUploadProtocol(req).start(res, await contextOf(req));
	});

	router.post("/", ...deps.stageGates, async (req, res) => {
		const body = StartUploadBody.safeParse(req.body);
		const { fileName, byteLength } = body.success ? body.data : {};
		const uploadCeilingBytes = Math.max(
			...viewerKinds(req).map((kind) => kind.uploadCeilingBytes),
		);
		if (byteLength !== undefined && byteLength > uploadCeilingBytes) {
			await write(req, res, { outcome: "upload_too_large" });
			return;
		}
		const uploadId = deps.mintUploadId();
		await deps.createMediaUploadSession({
			uploadId,
			userId: req.userId,
			...(fileName === undefined ? {} : { fileName }),
			...(byteLength === undefined ? {} : { byteLength }),
			saveAttemptId: newSaveAttemptId(),
		});
		const post = await deps.mintMediaPendingPost({
			uploadId,
			uploadCeilingBytes,
			successAction: deps.pickUploadProtocol(req).s3SuccessAction(`${deps.appOrigin}/upload/${uploadId}`),
		});
		await write(req, res, {
			outcome: "staged",
			uploadId,
			post,
			uploadCeilingBytes,
		});
	});

	async function findOwnSession(req: Request) {
		const uploadId = UploadIdSchema.safeParse(req.params.id);
		if (!uploadId.success) return undefined;
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
			await write(req, res, { outcome: RECEIVED_AGAIN[session.status], uploadId: session.uploadId });
			return;
		}
		const head = await deps.headMediaPendingOriginal({ uploadId: session.uploadId });
		if (!head) {
			await write(req, res, { outcome: "upload_not_received" });
			return;
		}
		const prefix = await deps.readMediaPendingPrefix({
			uploadId: session.uploadId,
			etag: head.etag,
			bytes: SNIFF_BYTES,
		});
		const kind = detectUploadKind({
			kinds: deps.MEDIA_KINDS,
			offered: viewerKinds(req),
			fileName: session.fileName,
			prefix,
		});
		if (!kind) {
			deps.logger.info("[Upload] unsupported type", { extension: refusedExtension(session.fileName) });
			await write(req, res, { outcome: "upload_unsupported_type" });
			return;
		}
		if (head.size > kind.uploadCeilingBytes) {
			await write(req, res, { outcome: "upload_too_large" });
			return;
		}
		await write(
			req,
			res,
			await deps.settleReceivedUpload({
				session,
				kind,
				etag: head.etag,
				size: head.size,
			}),
		);
	});

	return router;
}
