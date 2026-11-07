import type { MediaKindManifest } from "@packages/media-contracts";
import { unsupportedTypeMessageOf } from "./upload-copy";

const FIXED_UPLOAD_ERROR_MESSAGES = {
	upload_too_large: "That file is over the upload limit.",
	upload_not_received:
		"We didn't receive your file. Choose it and upload it again.",
	upload_session_not_found: "We couldn't find that upload. Start a new one.",
} as const;

export type UploadErrorCode =
	| keyof typeof FIXED_UPLOAD_ERROR_MESSAGES
	| "upload_unsupported_type";

export function uploadErrorMessageOf(input: {
	code: UploadErrorCode;
	kinds: readonly MediaKindManifest[];
}): string {
	return input.code === "upload_unsupported_type"
		? unsupportedTypeMessageOf(input.kinds)
		: FIXED_UPLOAD_ERROR_MESSAGES[input.code];
}

export const UPLOAD_FAILED_MESSAGE =
	"We couldn't open that upload. Check your readlist for the reason, or upload the file again.";

export const UPLOAD_ERROR_STATUS: Record<UploadErrorCode, number> = {
	upload_unsupported_type: 422,
	upload_too_large: 413,
	upload_not_received: 409,
	upload_session_not_found: 404,
};
