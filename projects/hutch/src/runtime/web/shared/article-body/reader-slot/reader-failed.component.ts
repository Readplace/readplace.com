import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import { type ArticleDestinationUrl, isPrivateItemUrl } from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render, renderAlert, renderIllustration, withInternalTracking } from "@packages/web-shell";
import { FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE } from "../../client-surface-phrases";
import type { CapturePollUrls } from "../../article-reader/article-reader.types";
import type { CaptureRescue } from "./failed-crawl-notice";
import type { ReaderHighlightState } from "./mark-highlights";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

const MARKER_TEMPLATE = readFileSync(
	join(__dirname, "reader-notice-marker.template.html"),
	"utf-8",
);

const { t } = translator(hutchReader, DEFAULT_LOCALE);

export type { ReaderFailedVariant };

export interface ReaderFailedInput {
	url: ArticleDestinationUrl;
	articleId: string | undefined;
	/**
	 * Distinguishes the four states that all surface the same "your link is
	 * saved, open it on the source" page:
	 *   - `unsupported`: terminal — PDFs, images, archives, anything reader view can't render.
	 *   - `failed`: transient — the fetch errored.
	 *   - `blocked`: an origin edge refused our servers.
	 *   - `slow`: pending past the poll cap — worker still might land but the user shouldn't wait.
	 *   - `not-found`: the origin answered 404/410 — nothing can fetch what is gone.
	 */
	variant: ReaderFailedVariant;
	explanation?: string;
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
	capturePollUrls?: CapturePollUrls;
	captureRescue: CaptureRescue;
	oob?: boolean;
	noticeOob: boolean;
}

export interface ReaderRegions {
	slot: string;
	notice: string;
	states: readonly ReaderHighlightState[];
}

const TITLES: Record<ReaderFailedVariant, string> = {
	unsupported: t("articleBody.readerFailed.title.linkSaved"),
	failed: t("articleBody.readerFailed.title.linkSaved"),
	blocked: t("articleBody.readerFailed.title.linkSaved"),
	slow: t("articleBody.readerFailed.title.linkSaved"),
	"origin-down": t("articleBody.readerFailed.title.linkSaved"),
	"not-found": t("articleBody.readerFailed.title.notFound"),
	"not-an-article": t("articleBody.readerFailed.title.linkSaved"),
	"capture-unreadable": t("articleBody.readerFailed.title.captureUnreadable"),
	"capture-missing": t("articleBody.readerFailed.title.captureMissing"),
	"processing-failed": t("articleBody.readerFailed.title.processingFailed"),
	"no-speech": t("articleBody.readerFailed.title.audioSaved"),
	"transcript-failed": t("articleBody.readerFailed.title.audioSaved"),
};

const EXPLANATIONS: Record<ReaderFailedVariant, string> = {
	unsupported: t("articleBody.readerFailed.explanation.unsupported"),
	failed: t("articleBody.readerFailed.explanation.failed", { alternatives: FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE }),
	blocked: t("articleBody.readerFailed.explanation.blocked", { alternatives: FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE }),
	slow: t("articleBody.readerFailed.explanation.slow"),
	"origin-down": t("articleBody.readerFailed.explanation.originDown"),
	"not-found": t("articleBody.readerFailed.explanation.notFound"),
	"not-an-article": t("articleBody.readerFailed.explanation.notAnArticle"),
	"capture-unreadable": t("articleBody.readerFailed.explanation.captureUnreadable"),
	"capture-missing": t("articleBody.readerFailed.explanation.captureMissing"),
	"processing-failed": t("articleBody.readerFailed.explanation.processingFailed"),
	"no-speech": t("articleBody.readerFailed.explanation.noSpeech"),
	"transcript-failed": t("articleBody.readerFailed.explanation.transcriptFailed"),
};

const CAPTURE_RESCUE_CLASS = {
	offered: "article-body__reader-notice-capture--offered",
	withheld: "article-body__reader-notice-capture--withheld",
} satisfies Record<CaptureRescue, string>;

const CTA_LABELS: Record<ReaderFailedVariant, string> = {
	unsupported: t("articleBody.readerFailed.cta.readOriginal"),
	failed: t("articleBody.readerFailed.cta.readOriginal"),
	blocked: t("articleBody.readerFailed.cta.readOriginal"),
	slow: t("articleBody.readerFailed.cta.readOriginal"),
	"origin-down": t("articleBody.readerFailed.cta.readOriginal"),
	"not-found": t("articleBody.readerFailed.cta.visitOriginal"),
	"not-an-article": t("articleBody.readerFailed.cta.readOriginal"),
	"capture-unreadable": t("articleBody.readerFailed.cta.readOriginal"),
	"capture-missing": t("articleBody.readerFailed.cta.readOriginal"),
	"processing-failed": t("articleBody.readerFailed.cta.uploadAgain"),
	"no-speech": t("articleBody.readerFailed.cta.uploadAgain"),
	"transcript-failed": t("articleBody.readerFailed.cta.uploadAgain"),
};

/* Every other variant can still be rescued by capturing the page from a client,
 * so the pitch is worth making. A page the origin has deleted cannot — pitching
 * a capture there sells a fix that does not exist. */
const CAPTURE_PITCH_VARIANTS: ReadonlySet<ReaderFailedVariant> = new Set([
	"failed",
	"unsupported",
	"slow",
	"blocked",
]);

const CAPTURE_PITCH_KEY = "reader-capture-pitch";

const CAPTURE_PITCH_TITLE = t("articleBody.readerFailed.capturePitch.title", { alternatives: FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE });

const CAPTURE_PITCH_LINK_TEMPLATE = '<a href="{{href}}" data-test-reader-failed-install>{{t "articleBody.readerFailed.capturePitch.link"}}</a>';

const PITCH_CLASSES = {
	visible: "article-body__reader-notice-pitch article-body__reader-notice-pitch--visible",
	hidden: "article-body__reader-notice-pitch article-body__reader-notice-pitch--hidden",
} as const;

interface CapturePitch {
	pitchClass: (typeof PITCH_CLASSES)[keyof typeof PITCH_CLASSES];
	pitchHtml: string;
}

const WITHHELD_PITCH: CapturePitch = {
	pitchClass: PITCH_CLASSES.hidden,
	pitchHtml: renderAlert({ key: CAPTURE_PITCH_KEY, content: undefined }),
};

function renderCapturePitch(input: ReaderFailedInput): CapturePitch {
	if (isPrivateItemUrl(input.url)) return WITHHELD_PITCH;
	if (!CAPTURE_PITCH_VARIANTS.has(input.variant)) return WITHHELD_PITCH;
	if (!input.extensionInstallUrl) return WITHHELD_PITCH;
	const href = withInternalTracking(input.extensionInstallUrl, {
		source: "reader-failed",
		content: `install-${input.variant}`,
	});
	return {
		pitchClass: PITCH_CLASSES.visible,
		pitchHtml: renderAlert({
			key: CAPTURE_PITCH_KEY,
			content: {
				variant: "info",
				title: { text: CAPTURE_PITCH_TITLE, element: "p" },
				message: { html: render(CAPTURE_PITCH_LINK_TEMPLATE, { href }) },
			},
		}),
	};
}

const UPLOAD_AGAIN_HREF = withInternalTracking("/upload", { source: "reader-failed", content: "upload-again" });

function primaryHrefFor(input: ReaderFailedInput): string | undefined {
	if (input.variant === "processing-failed" || input.variant === "transcript-failed") return UPLOAD_AGAIN_HREF;
	if (isPrivateItemUrl(input.url)) return undefined;
	return input.url;
}

function rescueFor(input: ReaderFailedInput): { url: ArticleDestinationUrl; articleId: string } | undefined {
	if (input.captureRescue !== "offered") return undefined;
	if (input.capturePollUrls === undefined) return undefined;
	if (input.articleId === undefined) return undefined;
	return { url: input.url, articleId: input.articleId };
}

export function renderReaderFailed(input: ReaderFailedInput): ReaderRegions {
	return {
		states: [],
		slot: render(MARKER_TEMPLATE, {
			variant: input.variant,
			oob: input.oob === true,
		}),
		notice: render(TEMPLATE, {
			primaryHref: primaryHrefFor(input),
			variant: input.variant,
			noticeOob: input.noticeOob,
			illustrationHtml: renderIllustration("book-lightbulb"),
			title: TITLES[input.variant],
			explanation: input.explanation ?? EXPLANATIONS[input.variant],
			ctaLabel: CTA_LABELS[input.variant],
			captureClass: CAPTURE_RESCUE_CLASS[input.captureRescue],
			capturePollUrls: input.capturePollUrls,
			rescue: rescueFor(input),
			...renderCapturePitch(input),
		}),
	};
}
