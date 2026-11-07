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
	MintMediaPendingPost,
	ReadMediaPendingPrefix,
} from "@packages/domain";
import { type MediaKindManifest, type MediaKindName, type UploadId, UploadIdSchema } from "@packages/media-contracts";
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
import { isMeteredStart, uploadStartPathOf } from "./upload-features";
import { type UploadRefusalReason, uploadRefusalMessage } from "./upload.refusal";
import {
	acceptAttributeOf,
	detectUploadKind,
	kindsForViewer,
	toUploadStartViewModel,
	transcriptAllowanceMinutesOf,
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
				start: toUploadStartViewModel(
					context.kinds,
					Boolean(context.req.userId),
					uploadStartPathOf(isMeteredStart(context.req.query)),
				),
				error: {
					code,
					message: uploadErrorMessageOf({ code, kinds: context.kinds }),
				},
			}),
			statusCode: UPLOAD_ERROR_STATUS[code],
		});
	};
}

function refusalWriter(reason: UploadRefusalReason): (res: Response) => void {
	return (res) => {
		res.redirect(303, `${uploadStartPathOf(true)}&refused=${reason}`);
	};
}

export const UPLOAD_OUTCOME_HTML: UploadOutcomeWriters = {
	staged: (res, outcome, context) => {
		const start = toUploadStartViewModel(
			context.kinds,
			Boolean(context.req.userId),
			uploadStartPathOf(false),
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
		res.redirect(303, "/queue");
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
	METERED_GUEST_UPLOAD_KINDS: readonly MediaKindName[];
	METERED_ONLY_UPLOAD_KINDS: readonly MediaKindName[];
	transcriptAllowanceSeconds: number;
	pickOutcomeWriters: (req: Request) => UploadOutcomeWriters;
	buildBannerState: BuildBannerState;
	appOrigin: string;
}

export function initUploadRouter(deps: UploadRouteDependencies): Router {
	const router = express.Router();
	const viewerKinds = (req: Request, metered = isMeteredStart(req.query)) =>
		kindsForViewer({
			kinds: deps.MEDIA_KINDS,
			guestKinds: metered ? deps.METERED_GUEST_UPLOAD_KINDS : deps.GUEST_UPLOAD_KINDS,
			isSignedIn: Boolean(req.userId),
		}).filter((kind) => metered || !deps.METERED_ONLY_UPLOAD_KINDS.includes(kind.name));

	async function write<K extends UploadOutcomeKey>(
		req: Request,
		res: Response,
		outcome: UploadOutcome<K>,
	) {
		const context: UploadWriteContext = {
			req,
			bannerState: await deps.buildBannerState(req),
			kinds: viewerKinds(req),
		};
		writeUploadOutcome({
			writers: deps.pickOutcomeWriters(req),
			res,
			outcome,
			context,
		});
	}

	router.get("/", async (req, res) => {
		const metered = isMeteredStart(req.query);
		const kinds = viewerKinds(req, metered);
		sendComponent(
			req,
			res,
			Base(
				UploadPage({
					view: "start",
					start: {
						...toUploadStartViewModel(kinds, Boolean(req.userId), uploadStartPathOf(metered)),
						refusalMessage: uploadRefusalMessage(req.query),
						transcriptAllowanceMinutes: transcriptAllowanceMinutesOf({
							kinds,
							metered,
							allowanceSeconds: deps.transcriptAllowanceSeconds,
						}),
					},
				}),
				await deps.buildBannerState(req),
			),
		);
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
			...(isMeteredStart(req.query) ? { metered: true } : {}),
			saveAttemptId: newSaveAttemptId(),
		});
		const post = await deps.mintMediaPendingPost({
			uploadId,
			uploadCeilingBytes,
			successActionRedirect: `${deps.appOrigin}/upload/${uploadId}`,
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
			offered: viewerKinds(req, session.metered === true),
			fileName: session.fileName,
			prefix,
		});
		if (!kind) {
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
