import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { UploadErrorCode } from "./upload.error";
import { UPLOAD_ERROR_MESSAGES } from "./upload.error";
import { UPLOAD_STYLES } from "./upload.styles";
import type { UploadStartViewModel } from "./upload.viewmodel";

const UPLOAD_TEMPLATE = readFileSync(join(__dirname, "upload.template.html"), "utf-8");

export type UploadPageState =
	| { view: "start"; start: UploadStartViewModel; errorCode?: UploadErrorCode }
	| {
			view: "staged";
			staged: { url: string; fields: { name: string; value: string }[]; ceilingLabel: string; accept: string };
		}
	| { view: "continue"; uploadId: string }
	| { view: "failed" };

function templateDataOf(state: UploadPageState): object {
	switch (state.view) {
		case "start":
			return {
				start: state.start,
				errorCode: state.errorCode,
				errorAlertHtml:
					state.errorCode &&
					renderAlert({
						key: "upload",
						content: { variant: "error", message: { text: UPLOAD_ERROR_MESSAGES[state.errorCode] } },
					}),
			};
		case "staged":
			return { staged: state.staged };
		case "continue":
			return { continueUploadId: state.uploadId };
		case "failed":
			return {
				failedAlertHtml: renderAlert({
					key: "upload",
					content: {
						variant: "warning",
						message: {
							text: "We couldn't open that upload. Check your readlist for the reason, or upload the file again.",
						},
					},
				}),
			};
	}
}

export function UploadPage(state: UploadPageState): PageBody {
	return {
		seo: {
			title: "Upload a book — Readplace",
			description: "Upload a DRM-free EPUB book to read in Readplace.",
			canonicalUrl: "/upload",
			robots: "noindex, follow",
		},
		styles: UPLOAD_STYLES,
		bodyClass: "page-upload",
		content: { html: render(UPLOAD_TEMPLATE, templateDataOf(state)) },
	};
}
