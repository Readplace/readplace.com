import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { UploadErrorCode } from "./upload.error";
import { UPLOAD_STYLES } from "./upload.styles";
import type { UploadStartViewModel } from "./upload.viewmodel";

const UPLOAD_TEMPLATE = readFileSync(join(__dirname, "upload.template.html"), "utf-8");

export type UploadPageState =
	| {
			view: "start";
			start: UploadStartViewModel;
			error?: { code: UploadErrorCode; message: string };
		}
	| {
			view: "staged";
			staged: {
				url: string;
				fields: { name: string; value: string }[];
				heading: string;
				descriptions: readonly string[];
				accept: string;
			};
		}
	| { view: "continue"; uploadId: string }
	| { view: "failed" };

function templateDataOf(state: UploadPageState): object {
	switch (state.view) {
		case "start":
			return {
				start: state.start,
				heading: state.start.heading,
				errorCode: state.error?.code,
				refusalAlertHtml: renderAlert({
					key: "upload-refusal",
					content: state.start.refusalMessage
						? { variant: "error", message: { text: state.start.refusalMessage } }
						: undefined,
				}),
				errorAlertHtml:
					state.error &&
					renderAlert({
						key: "upload",
						content: {
							variant: "error",
							message: { text: state.error.message },
						},
					}),
			};
		case "staged":
			return { staged: state.staged, heading: state.staged.heading };
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
			title: "Upload — Readplace",
			description: "Upload a file to read or listen to in Readplace.",
			canonicalUrl: "/upload",
			robots: "noindex, follow",
		},
		styles: UPLOAD_STYLES,
		bodyClass: "page-upload",
		content: { html: render(UPLOAD_TEMPLATE, templateDataOf(state)) },
	};
}
