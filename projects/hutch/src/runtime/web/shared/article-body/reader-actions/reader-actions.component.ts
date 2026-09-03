import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import { type Component, HtmlPage, render } from "@packages/web-shell";

const TOP_TEMPLATE = readFileSync(join(__dirname, "reader-actions-top.template.html"), "utf-8");
const BOTTOM_TEMPLATE = readFileSync(join(__dirname, "reader-actions-bottom.template.html"), "utf-8");

export interface MarkReadAction {
	position: "top" | "bottom";
	postUrl: string;
	label: string;
	shortLabel: string;
	iconName: IconName;
	testAction: string;
	fields: ReadonlyArray<{ name: string; value: string }>;
	confirmPopoverId?: string;
}

export interface ReaderReadlistPicker {
	assignUrl: string;
	returnTo: string;
	options: readonly { slug: ReadlistSlug; label: string }[];
	create: { createUrl: string; maxLength: number } | undefined;
}

export interface ActionButtons {
	backLink?: { topHref: string; bottomHref?: string; label: string };
	markReadActions?: ReadonlyArray<MarkReadAction>;
	readlistPicker: ReaderReadlistPicker | undefined;
	epubDownload?: { href: string };
}

export type RenderReaderActions = (params: { actionBtns: ActionButtons }) => {
	top: Component;
	bottom: Component;
	/** The page body class for this variant. Colocated with the action markup so
	 * the sticky toolbar and the CSS that pins it can never drift apart. */
	bodyClass: string;
};

function markReadFields(action: MarkReadAction | undefined) {
	if (action === undefined) return undefined;
	const confirmPopoverId = action.confirmPopoverId;
	return {
		postUrl: action.postUrl,
		label: action.label,
		shortLabel: action.shortLabel,
		iconName: action.iconName,
		fields: action.fields,
		testAction:
			confirmPopoverId === undefined ? action.testAction : `${action.testAction}-fallback`,
		formClass:
			confirmPopoverId === undefined
				? "article-body__mark-read-form"
				: "article-body__mark-read-form article-body__mark-read-fallback",
		confirmTriggers:
			confirmPopoverId === undefined
				? []
				: [
						{
							popoverId: confirmPopoverId,
							label: action.label,
							shortLabel: action.shortLabel,
							iconName: action.iconName,
							testAction: action.testAction,
						},
					],
	};
}

function topBar(actionBtns: ActionButtons): string {
	return render(TOP_TEMPLATE, {
		backLink: actionBtns.backLink
			? { href: actionBtns.backLink.topHref, label: actionBtns.backLink.label }
			: undefined,
		readlistPicker: actionBtns.readlistPicker,
		epubDownload: actionBtns.epubDownload,
		markRead: markReadFields(actionBtns.markReadActions?.find((action) => action.position === "top")),
	});
}

function bottomBar(actionBtns: ActionButtons, markRead: MarkReadAction | undefined): string {
	return render(BOTTOM_TEMPLATE, {
		backLink: actionBtns.backLink
			? { href: actionBtns.backLink.bottomHref, label: actionBtns.backLink.label }
			: undefined,
		markRead: markReadFields(markRead),
	});
}

export const RegularReader: RenderReaderActions = ({ actionBtns }) => ({
	top: HtmlPage(topBar(actionBtns)),
	bottom: HtmlPage(
		bottomBar(actionBtns, actionBtns.markReadActions?.find((action) => action.position === "bottom")),
	),
	bodyClass: "page-reader",
});

/** The reader action bar for the reading experience — one sticky toolbar that
 * keeps Back + Mark-as-read reachable while the article scrolls, with no bottom
 * bar. Both readers render it identically; `StickyReader` and `ChromelessReader`
 * differ only in the body class, which decides where the toolbar pins (below the
 * web header vs. the top of the iOS native sheet). */
function stickyReaderActions(actionBtns: ActionButtons): { top: Component; bottom: Component } {
	return {
		top: HtmlPage(`<div class="article-body__actions--sticky">${topBar(actionBtns)}</div>`),
		bottom: HtmlPage(""),
	};
}

export const StickyReader: RenderReaderActions = ({ actionBtns }) => ({
	...stickyReaderActions(actionBtns),
	bodyClass: "page-reader",
});

export const ChromelessReader: RenderReaderActions = ({ actionBtns }) => ({
	...stickyReaderActions(actionBtns),
	bodyClass: "page-reader page-reader--chromeless",
});
