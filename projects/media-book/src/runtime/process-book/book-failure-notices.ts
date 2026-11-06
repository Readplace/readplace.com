import type { MediaFailureReason } from "@packages/media-contracts";

export type BookFailure = "staged-bytes-gone" | "drm-protected" | "not-an-epub" | "too-large-for-reader";

export const BOOK_FAILURES: Record<BookFailure, { reason: MediaFailureReason; notice: string }> = {
	"staged-bytes-gone": {
		reason: "staged-bytes-gone",
		notice: "We couldn't find the file you uploaded. Please upload it again.",
	},
	"drm-protected": {
		reason: "unreadable",
		notice: "This book is protected by DRM, so we can't open it. Upload a DRM-free copy.",
	},
	"not-an-epub": {
		reason: "unreadable",
		notice: "This file isn't an EPUB we can read. Check the file and upload it again.",
	},
	"too-large-for-reader": {
		reason: "too-large-for-reader",
		notice: "This book is too large to read or export. Split it into smaller EPUB files and upload each one.",
	},
};

export const PROCESSING_EXHAUSTED_NOTICE = "We couldn't prepare this book. Please upload it again.";
