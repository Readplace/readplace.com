import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { MediaKindName } from "@packages/media-contracts";
import { UPLOAD_STYLES } from "./upload.styles";

const UPLOAD_REVIEW_TEMPLATE = readFileSync(join(__dirname, "upload-review.template.html"), "utf-8");

export type UploadReviewView =
	| { view: "inspecting"; pollUrl: string; checkAgainUrl: string }
	| { view: "overrun"; uploadAgainUrl: string }
	| { view: "review"; title: string; authors: string; sectionTitles: readonly string[]; commitUrl: string }
	| {
			view: "timed-review";
			heading: string;
			transcriptMinutes: number;
			allowanceMinutes: number;
			commitUrl: string;
		}
	| { view: "too-long"; notice: string; uploadAgainUrl: string }
	| { view: "rejected"; notice: string; uploadAgainUrl: string };

const REVIEW_COPY: Record<MediaKindName, { heading: string; description: string }> = {
	book: { heading: "Upload a book", description: "Review an uploaded book before saving it to Readplace." },
	audio: { heading: "Upload an audio file", description: "Review an uploaded audio file before saving it to Readplace." },
	video: { heading: "Upload a video", description: "Review an uploaded video before saving it to Readplace." },
};

export function UploadReviewPage(params: {
	state: UploadReviewView;
	uploadId: string;
	media: MediaKindName;
}): PageBody {
	const { state } = params;
	const copy = REVIEW_COPY[params.media];
	return {
		seo: {
			canonicalUrl: `/upload/${params.uploadId}`,
			title: `${copy.heading} — Readplace`,
			description: copy.description,
			robots: "noindex, nofollow",
		},
		styles: UPLOAD_STYLES,
		bodyClass: "page-upload",
		content: { html: render(UPLOAD_REVIEW_TEMPLATE, { heading: copy.heading, [state.view.replace("-", "_")]: state }) },
	};
}
