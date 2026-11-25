import type { Response } from "express";
import type { UploadId } from "@packages/media-contracts";
import { SIREN_MEDIA_TYPE, type SirenEntity, type SirenMessage, sirenError } from "../../api/siren";
import { UPLOAD_ERROR_STATUS, UPLOAD_FAILED_MESSAGE, type UploadErrorCode, uploadErrorMessageOf } from "./upload.error";
import type { UploadOutcomeWriters, UploadWriteContext } from "./upload.outcome";
import { type TranscriptRefusalReason, bookQuotaMessageOf, uploadRefusalCopyOf } from "./upload.refusal";
import type { UploadProtocol } from "./upload.page";
import { uploadDescriptionOf, uploadHeadingOf } from "./upload-copy";
import { uploadStartPathOf } from "./upload-features";
import { transcriptAllowanceOf } from "./upload.viewmodel";

function sendSiren(res: Response, status: number, entity: SirenEntity): void {
	res.status(status).type(SIREN_MEDIA_TYPE).json(entity);
}

function uploadError(error: { code: string; message: string }): SirenEntity {
	const entity = sirenError(error);
	const messages: SirenMessage[] = [{ type: "error", content: { type: "text/html", body: error.message } }];
	return { ...entity, properties: { ...entity.properties, messages } };
}

function confirmReceivedAction(uploadId: UploadId) {
	return { name: "confirm-received", href: `/upload/${uploadId}/received`, method: "POST" };
}

function selfLink(uploadId: UploadId) {
	return { rel: ["self"], href: `/upload/${uploadId}` };
}

function writeStart(res: Response, context: UploadWriteContext): void {
	const startPath = uploadStartPathOf(context.metered);
	sendSiren(res, 200, {
		class: ["upload"],
		properties: {
			heading: uploadHeadingOf(context.kinds),
			kinds: context.kinds.map((kind) => ({
				name: kind.name,
				description: uploadDescriptionOf(kind),
				accepts: kind.accepts,
				uploadCeilingBytes: kind.uploadCeilingBytes,
				ceilingLabel: kind.ceilingLabel,
			})),
			transcriptAllowance: transcriptAllowanceOf({
				kinds: context.kinds,
				allowanceSeconds: context.transcriptAllowanceSeconds,
			}),
		},
		links: [{ rel: ["self"], href: startPath }],
		actions: [
			{
				name: "stage-upload",
				href: startPath,
				method: "POST",
				type: "application/x-www-form-urlencoded",
				fields: [
					{ name: "fileName", type: "text" },
					{ name: "byteLength", type: "number" },
				],
			},
		],
	});
}

function errorWriter(code: UploadErrorCode): (res: Response, _outcome: unknown, context: UploadWriteContext) => void {
	return (res, _outcome, context) => {
		sendSiren(
			res,
			UPLOAD_ERROR_STATUS[code],
			uploadError({ code, message: uploadErrorMessageOf({ code, kinds: context.kinds }) }),
		);
	};
}

function refusalWriter(
	reason: TranscriptRefusalReason,
): (res: Response, _outcome: unknown, context: UploadWriteContext) => void {
	return (res, _outcome, context) => {
		sendSiren(
			res,
			422,
			uploadError({ code: reason, message: uploadRefusalCopyOf(context.transcriptAllowanceSeconds)[reason] }),
		);
	};
}

const UPLOAD_OUTCOME_SIREN: UploadOutcomeWriters = {
	staged: (res, outcome) => {
		sendSiren(res, 200, {
			class: ["upload-staged"],
			links: [selfLink(outcome.uploadId)],
			actions: [
				{
					name: "upload-content",
					href: outcome.post.url,
					method: "POST",
					type: "multipart/form-data",
					fields: [
						...Object.entries(outcome.post.fields).map(([name, value]) => ({ name, type: "hidden", value })),
						{ name: "file", type: "file" },
					],
				},
				confirmReceivedAction(outcome.uploadId),
			],
		});
	},
	committed: (res) => {
		res.redirect(303, "/queue");
	},
	"staged-for-review": (res, outcome) => {
		res.redirect(303, `/upload/${outcome.uploadId}`);
	},
	continue: (res, outcome) => {
		sendSiren(res, 200, {
			class: ["upload-staged"],
			links: [selfLink(outcome.uploadId)],
			actions: [confirmReceivedAction(outcome.uploadId)],
		});
	},
	failed: (res) => {
		sendSiren(res, 422, uploadError({ code: "upload_failed", message: UPLOAD_FAILED_MESSAGE }));
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
		const error = uploadError({ code: "book-quota", message: bookQuotaMessageOf(outcome.retryAt) });
		sendSiren(res, 422, { ...error, properties: { ...error.properties, retryAt: outcome.retryAt.toISOString() } });
	},
};

export const UPLOAD_PROTOCOL_SIREN: UploadProtocol = {
	start: writeStart,
	writers: UPLOAD_OUTCOME_SIREN,
	s3SuccessAction: () => ({ status: "201" }),
};
