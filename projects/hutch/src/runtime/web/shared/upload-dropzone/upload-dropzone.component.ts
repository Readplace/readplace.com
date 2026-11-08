import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_IMPORT_FILE_BYTES } from "@packages/domain/import-session";
import type { MediaKindManifest } from "@packages/media-contracts";
import { render } from "@packages/web-shell";
import { IMPORT_LIMITS } from "../../pages/import/import.limits";
import { uploadFormatsOf } from "../../pages/upload/upload-copy";
import { acceptAttributeOf } from "../../pages/upload/upload.viewmodel";

export { UPLOAD_DROPZONE_STYLES } from "./upload-dropzone.styles";

export const UPLOAD_DROPZONE_SCRIPT = `<script src="/client-dist/upload-dropzone.client.js" defer></script>`;

const UPLOAD_DROPZONE_TEMPLATE = readFileSync(join(__dirname, "upload-dropzone.template.html"), "utf-8");

const UPLOAD_START_ACTION = "/upload";

function messagesOf(kinds: readonly MediaKindManifest[]) {
	return {
		unsupported: `That file type isn't supported. Choose a list of links (HTML, JSON, CSV, or plain text) or ${uploadFormatsOf(kinds)}.`,
		importTooLarge: `That file is too large. The limit is ${IMPORT_LIMITS.maxFileSize} — split the export into smaller files and import them one at a time.`,
		failed: "The upload didn't go through. Try again.",
	};
}

function offeredKindOf(kind: MediaKindManifest) {
	return {
		name: kind.name,
		accept: [...Object.keys(kind.accepts), acceptAttributeOf([kind])].join(","),
		maxBytes: kind.uploadCeilingBytes,
		ceilingLabel: kind.ceilingLabel,
		format: uploadFormatsOf([kind]),
		tooLarge: `That ${kind.label.toLowerCase()} is too large. The limit is ${kind.ceilingLabel}.`,
	};
}

export interface UploadDropzoneInput {
	readonly importAction: string;
	readonly bookFallbackHref: string;
	readonly signInHref?: string;
	readonly disabled: boolean;
	readonly idPrefix: string;
	readonly formId: string;
	readonly showSubmit: boolean;
	readonly uploadOnChoose: boolean;
	readonly kinds: readonly MediaKindManifest[];
}

export function renderUploadDropzone(input: UploadDropzoneInput): string {
	return render(UPLOAD_DROPZONE_TEMPLATE, {
		...input,
		uploadStartAction: UPLOAD_START_ACTION,
		offeredKinds: input.kinds.map(offeredKindOf),
		importMaxBytes: MAX_IMPORT_FILE_BYTES,
		limits: IMPORT_LIMITS,
		messages: messagesOf(input.kinds),
	});
}
