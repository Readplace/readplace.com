import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_IMPORT_FILE_BYTES } from "@packages/domain/import-session";
import { BOOK } from "@packages/media-contracts";
import { render } from "@packages/web-shell";
import { IMPORT_LIMITS } from "../../pages/import/import.limits";

export { UPLOAD_DROPZONE_STYLES } from "./upload-dropzone.styles";

export const UPLOAD_DROPZONE_SCRIPT = `<script src="/client-dist/upload-dropzone.client.js" defer></script>`;

const UPLOAD_DROPZONE_TEMPLATE = readFileSync(join(__dirname, "upload-dropzone.template.html"), "utf-8");

const BOOK_START_ACTION = "/upload";

const MESSAGES = {
	unsupported: "That file type isn't supported. Choose a list of links (HTML, JSON, CSV, or plain text) or a DRM-free EPUB.",
	importTooLarge: `That file is too large. The limit is ${IMPORT_LIMITS.maxFileSize} — split the export into smaller files and import them one at a time.`,
	bookTooLarge: `That book is too large. The limit is ${BOOK.ceilingLabel}.`,
	failed: "The upload didn't go through. Try again.",
};

function bookAcceptOf(accepts: Readonly<Record<string, readonly string[]>>): string {
	return Object.entries(accepts)
		.map(([type, extensions]) => `${type}:${extensions.join(",")}`)
		.join(";");
}

export interface UploadDropzoneInput {
	readonly importAction: string;
	readonly bookFallbackHref: string;
	readonly signInHref?: string;
	readonly disabled: boolean;
	readonly idPrefix: string;
}

export function renderUploadDropzone(input: UploadDropzoneInput): string {
	return render(UPLOAD_DROPZONE_TEMPLATE, {
		...input,
		bookStartAction: BOOK_START_ACTION,
		bookAccept: bookAcceptOf(BOOK.accepts),
		bookMaxBytes: BOOK.uploadCeilingBytes,
		bookCeilingLabel: BOOK.ceilingLabel,
		importMaxBytes: MAX_IMPORT_FILE_BYTES,
		limits: IMPORT_LIMITS,
		messages: MESSAGES,
	});
}
