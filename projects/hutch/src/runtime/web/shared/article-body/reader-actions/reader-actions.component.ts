import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { IconName } from "@packages/ui-icons";
import type { SaveClient } from "@packages/web-analytics";
import {
	type Component,
	DISTRACTION_FREE_BODY_CLASS,
	HtmlPage,
	render,
	renderInFlightDots,
} from "@packages/web-shell";
import { DOWNLOAD_GUIDE_POPOVER_ID, renderDownloadGuideFallback } from "../../download-guide/download-guide.component";
import type { EpubDownloadGuide } from "../../epub/epub-download-guide";
import { articleEpubHref } from "../../epub/epub-link";

export const READLIST_PICKER_SCRIPT = `<script src="/client-dist/readlist-picker.client.js" defer></script>`;

const TOP_TEMPLATE = readFileSync(join(__dirname, "reader-actions-top.template.html"), "utf-8");
const BOTTOM_TEMPLATE = readFileSync(join(__dirname, "reader-actions-bottom.template.html"), "utf-8");
const DOWNLOADS_TEMPLATE = readFileSync(join(__dirname, "reader-downloads.template.html"), "utf-8");
const SHARE_TEMPLATE = readFileSync(join(__dirname, "reader-share.template.html"), "utf-8");
const MARK_READ_LOADER = renderInFlightDots("article-body__mark-read-loader in-flight-dots");

export interface MarkReadAction {
	position: "top" | "bottom";
	postUrl: string;
	label: string;
	iconName: IconName;
	testAction: string;
	fields: ReadonlyArray<{ name: string; value: string }>;
	confirmPopoverId?: string;
}

export interface ReaderReadlistPicker {
	assignUrl: string;
	returnTo: string;
	options: readonly { slug: ReadlistSlug; label: string; iconName: IconName }[];
	create:
		| { createUrl: string; maxLength: number; popoverId: string; nameLabel: string; namePlaceholder: string }
		| undefined;
}

type ReaderControlPlacement = "toolbar" | "menu";

interface ReaderShare {
	popoverId: string;
	fallbackHtml: string;
}

export interface ActionButtons {
	backLink?: { topHref: string; bottomHref?: string; label: string };
	markReadActions?: ReadonlyArray<MarkReadAction>;
	readlistPicker: ReaderReadlistPicker | undefined;
	share?: ReaderShare;
	epubDownloadHref?: string;
	epubDownloadGuide?: EpubDownloadGuide;
	menu?: { deleteItemsHtml: string };
}

export type RenderReaderActions = (params: { actionBtns: ActionButtons }) => {
	top: Component;
	bottom: Component;
	/** The page body class for this variant. */
	bodyClass: string;
};

function markReadFields(action: MarkReadAction | undefined) {
	if (action === undefined) return undefined;
	const confirmPopoverId = action.confirmPopoverId;
	return {
		loaderHtml: MARK_READ_LOADER,
		postUrl: action.postUrl,
		label: action.label,
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
							iconName: action.iconName,
							testAction: action.testAction,
						},
					],
	};
}

function downloadsSlotView(params: { href: string | undefined; guide: EpubDownloadGuide | undefined }) {
	if (params.href === undefined) return { visible: false };
	if (params.guide === undefined) return { visible: true, link: { href: params.href } };
	return {
		visible: true,
		guide: { popoverId: DOWNLOAD_GUIDE_POPOVER_ID, fallbackHtml: renderDownloadGuideFallback(params.guide) },
	};
}

function renderReaderDownloads(params: {
	href: string | undefined;
	guide: EpubDownloadGuide | undefined;
	placement: ReaderControlPlacement;
	oob: boolean;
}): string {
	return render(DOWNLOADS_TEMPLATE, {
		...downloadsSlotView({ href: params.href, guide: params.guide }),
		menu: params.placement === "menu",
		oob: params.oob,
	});
}

function renderReaderShare(params: { share: ReaderShare | undefined; placement: ReaderControlPlacement }): string {
	if (params.share === undefined) return "";
	return render(SHARE_TEMPLATE, { ...params.share, menu: params.placement === "menu" });
}

export function renderReaderDownloadsSlotOob(params: {
	downloadHref: string;
	guide: EpubDownloadGuide | undefined;
	placements: readonly ReaderControlPlacement[];
}): string {
	return params.placements
		.map((placement) => renderReaderDownloads({ href: params.downloadHref, guide: params.guide, placement, oob: true }))
		.join("");
}

export function renderReaderDownloadsOob(params: {
	articleUrl: string;
	appClient: SaveClient | undefined;
	guide: EpubDownloadGuide | undefined;
}): string {
	return renderReaderDownloadsSlotOob({
		downloadHref: articleEpubHref({ articleUrl: params.articleUrl, utmSource: "reader", appClient: params.appClient }),
		guide: params.guide,
		placements: ["toolbar", "menu"],
	});
}

function topBar(actionBtns: ActionButtons): string {
	const downloadsAt = (placement: ReaderControlPlacement): string =>
		renderReaderDownloads({
			href: actionBtns.epubDownloadHref,
			guide: actionBtns.epubDownloadGuide,
			placement,
			oob: false,
		});
	return render(TOP_TEMPLATE, {
		backLink: actionBtns.backLink
			? { href: actionBtns.backLink.topHref, label: actionBtns.backLink.label }
			: undefined,
		readlistPicker: actionBtns.readlistPicker,
		shareHtml: renderReaderShare({ share: actionBtns.share, placement: "toolbar" }),
		downloadsHtml: downloadsAt("toolbar"),
		menu:
			actionBtns.menu === undefined
				? undefined
				: {
						shareHtml: renderReaderShare({ share: actionBtns.share, placement: "menu" }),
						downloadsHtml: downloadsAt("menu"),
						deleteItemsHtml: actionBtns.menu.deleteItemsHtml,
					},
		markRead: markReadFields(actionBtns.markReadActions?.find((action) => action.position === "top")),
	});
}

function toolbar(actionBtns: ActionButtons): string {
	return `<div class="article-body__toolbar">${topBar(actionBtns)}</div>`;
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
	top: HtmlPage(toolbar(actionBtns)),
	bottom: HtmlPage(
		bottomBar(actionBtns, actionBtns.markReadActions?.find((action) => action.position === "bottom")),
	),
	bodyClass: `page-reader ${DISTRACTION_FREE_BODY_CLASS}`,
});

function toolbarOnlyActions(actionBtns: ActionButtons): { top: Component; bottom: Component } {
	return {
		top: HtmlPage(toolbar(actionBtns)),
		bottom: HtmlPage(""),
	};
}

export const WebReader: RenderReaderActions = ({ actionBtns }) => ({
	...toolbarOnlyActions(actionBtns),
	bodyClass: `page-reader ${DISTRACTION_FREE_BODY_CLASS}`,
});

export const ChromelessReader: RenderReaderActions = ({ actionBtns }) => ({
	...toolbarOnlyActions(actionBtns),
	bodyClass: "page-reader page-reader--chromeless",
});
