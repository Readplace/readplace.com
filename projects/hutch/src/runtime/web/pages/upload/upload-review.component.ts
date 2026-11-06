import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { UPLOAD_STYLES } from "./upload.styles";

const UPLOAD_REVIEW_TEMPLATE = readFileSync(join(__dirname, "upload-review.template.html"), "utf-8");

export type UploadReviewView =
	| { view: "inspecting"; pollUrl: string; checkAgainUrl: string }
	| { view: "overrun" }
	| { view: "review"; title: string; authors: string; sectionTitles: readonly string[]; commitUrl: string }
	| { view: "rejected"; notice: string };

export function UploadReviewPage(params: { state: UploadReviewView; uploadId: string }): PageBody {
	const { state } = params;
	return {
		seo: {
			canonicalUrl: `/upload/${params.uploadId}`,
			title: "Upload a book — Readplace",
			description: "Review an uploaded book before saving it to Readplace.",
			robots: "noindex, nofollow",
		},
		styles: UPLOAD_STYLES,
		bodyClass: "page-upload",
		content: { html: render(UPLOAD_REVIEW_TEMPLATE, { [state.view]: state }) },
	};
}
