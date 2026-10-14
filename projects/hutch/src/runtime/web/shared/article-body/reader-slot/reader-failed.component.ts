import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleDestinationUrl } from "@packages/domain/article";
import { render, renderAlert, renderIllustration, withInternalTracking } from "@packages/web-shell";
import { FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE } from "../../client-surface-phrases";
import type { CaptureRescue } from "./failed-crawl-notice";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

const MARKER_TEMPLATE = readFileSync(
	join(__dirname, "reader-notice-marker.template.html"),
	"utf-8",
);

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
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
	capturePollUrl?: string;
	captureRescue: CaptureRescue;
	oob?: boolean;
	noticeOob: boolean;
}

export interface ReaderRegions {
	slot: string;
	notice: string;
}

const TITLES: Record<ReaderFailedVariant, string> = {
	unsupported: "Your link is saved",
	failed: "Your link is saved",
	blocked: "Your link is saved",
	slow: "Your link is saved",
	"origin-down": "Your link is saved",
	"not-found": "Link saved, but the article is unavailable",
	"not-an-article": "Your link is saved",
};

const EXPLANATIONS: Record<ReaderFailedVariant, string> = {
	unsupported: "This type of page isn't supported in the Readplace reader yet. You can still open it on the original site.",
	failed: `Readplace couldn't load the full article from this site. You can still read it on the original website, or save the full page using ${FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE}.`,
	blocked: `This site blocked Readplace from loading the full article. Use ${FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE} to save the complete page instead.`,
	slow: "Reader view is taking longer than usual.",
	"origin-down": "Readplace couldn't reach this site right now. It may be temporarily unavailable, so you can try again later.",
	"not-found": "This page no longer appears to exist, so Readplace couldn't retrieve the article content.",
	"not-an-article": "This link isn't an article, so it can't be shown in reader view.",
};

const CAPTURE_RESCUE_CLASS = {
	offered: "article-body__reader-notice-capture--offered",
	withheld: "article-body__reader-notice-capture--withheld",
} satisfies Record<CaptureRescue, string>;

const CTA_LABELS: Record<ReaderFailedVariant, string> = {
	unsupported: "Read original article",
	failed: "Read original article",
	blocked: "Read original article",
	slow: "Read original article",
	"origin-down": "Read original article",
	"not-found": "Visit original page",
	"not-an-article": "Read original article",
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

const CAPTURE_PITCH_TITLE = `Want the full article in Readplace? Save it with ${FULL_PAGE_CAPTURE_ALTERNATIVES_PHRASE}.`;

const CAPTURE_PITCH_LINK_TEMPLATE = '<a href="{{href}}" data-test-reader-failed-install>See ways to save</a>';

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

function rescueFor(input: ReaderFailedInput): { url: ArticleDestinationUrl; articleId: string } | undefined {
	if (input.captureRescue !== "offered") return undefined;
	if (input.capturePollUrl === undefined) return undefined;
	if (input.articleId === undefined) return undefined;
	return { url: input.url, articleId: input.articleId };
}

export function renderReaderFailed(input: ReaderFailedInput): ReaderRegions {
	return {
		slot: render(MARKER_TEMPLATE, {
			variant: input.variant,
			oob: input.oob === true,
		}),
		notice: render(TEMPLATE, {
			url: input.url,
			variant: input.variant,
			noticeOob: input.noticeOob,
			illustrationHtml: renderIllustration("book-lightbulb"),
			title: TITLES[input.variant],
			explanation: EXPLANATIONS[input.variant],
			ctaLabel: CTA_LABELS[input.variant],
			captureClass: CAPTURE_RESCUE_CLASS[input.captureRescue],
			capturePollUrl: input.capturePollUrl,
			rescue: rescueFor(input),
			...renderCapturePitch(input),
		}),
	};
}
