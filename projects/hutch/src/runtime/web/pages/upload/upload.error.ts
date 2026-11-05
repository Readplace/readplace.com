export const UPLOAD_ERROR_MESSAGES = {
	upload_unsupported_type: "That file type isn't supported. Upload a DRM-free EPUB.",
	upload_too_large: "That file is over the upload limit.",
	upload_not_received: "We didn't receive your file. Choose it and upload it again.",
	upload_bad_magic: "That file isn't an EPUB. Upload a DRM-free EPUB.",
	upload_session_not_found: "We couldn't find that upload. Start a new one.",
} as const;

export type UploadErrorCode = keyof typeof UPLOAD_ERROR_MESSAGES;

export const UPLOAD_ERROR_STATUS: Record<UploadErrorCode, number> = {
	upload_unsupported_type: 422,
	upload_too_large: 413,
	upload_not_received: 409,
	upload_bad_magic: 422,
	upload_session_not_found: 404,
};
