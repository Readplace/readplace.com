import type { Response } from "express";
import type { UploadId } from "@packages/media-contracts";
import { SIREN_MEDIA_TYPE, type SirenEntity, sirenError } from "../../api/siren";
import { UPLOAD_ERROR_STATUS, UPLOAD_FAILED_MESSAGE, type UploadErrorCode, uploadErrorMessageOf } from "./upload.error";
import type { UploadOutcomeWriters, UploadWriteContext } from "./upload.outcome";
import { UPLOAD_REFUSAL_COPY, type UploadRefusalReason } from "./upload.refusal";
import type { UploadProtocol } from "./upload.page";

function sendSiren(res: Response, status: number, entity: SirenEntity): void {
	res.status(status).type(SIREN_MEDIA_TYPE).json(entity);
}

function confirmReceivedAction(uploadId: UploadId) {
	return { name: "confirm-received", href: `/upload/${uploadId}/received`, method: "POST" };
}

function errorWriter(code: UploadErrorCode): (res: Response, _outcome: unknown, context: UploadWriteContext) => void {
	return (res, _outcome, context) => {
		sendSiren(
			res,
			UPLOAD_ERROR_STATUS[code],
			sirenError({ code, message: uploadErrorMessageOf({ code, kinds: context.kinds }) }),
		);
	};
}

function refusalWriter(reason: UploadRefusalReason): (res: Response) => void {
	return (res) => {
		sendSiren(res, 422, sirenError({ code: reason, message: UPLOAD_REFUSAL_COPY[reason] }));
	};
}

const UPLOAD_OUTCOME_SIREN: UploadOutcomeWriters = {
	staged: (res, outcome) => {
		sendSiren(res, 200, {
			class: ["upload-staged"],
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
		sendSiren(res, 200, { class: ["upload-staged"], actions: [confirmReceivedAction(outcome.uploadId)] });
	},
	failed: (res) => {
		sendSiren(res, 422, sirenError({ code: "upload_failed", message: UPLOAD_FAILED_MESSAGE }));
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

export const UPLOAD_PROTOCOL_SIREN: UploadProtocol = {
	writers: UPLOAD_OUTCOME_SIREN,
	s3SuccessAction: () => ({ status: "201" }),
};
