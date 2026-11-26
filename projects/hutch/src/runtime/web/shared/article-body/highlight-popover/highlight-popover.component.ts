import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighlightId } from "@packages/domain/article";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render } from "@packages/web-shell";
import {
	highlightNoteEditPopoverId,
	renderHighlightNoteDeleteTrigger,
} from "../highlights/highlight-note-dialog.component";
import {
	type HighlightsRailRowView,
	highlightDeletePopoverId,
} from "../highlights-rail/highlights-rail.component";
import type { ArticleSharing } from "../../../pages/reader/article-sharing";
import {
	ALL_SHARE_TARGETS,
	type ShareCampaign,
	type ShareTarget,
	type ShareTargetKey,
	buildShareTargets,
	taggedReaderViewUrl,
} from "../../share-dialog/share-dialog.component";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(join(__dirname, "highlight-popover.template.html"), "utf-8");

const PANEL_TEMPLATE = readFileSync(join(__dirname, "highlight-popover-panel.template.html"), "utf-8");

const COPY_STATUS_TEMPLATE = readFileSync(join(__dirname, "highlight-copy-status.template.html"), "utf-8");

const HINT_TEMPLATE = `<p id="manage-highlight-hint" hidden>{{t "articleBody.highlightPopover.hint"}}</p>`;

export function renderHighlightPopoverHint(): string {
	return render(HINT_TEMPLATE, {});
}

export function renderHighlightCopyStatus(): string {
	return render(COPY_STATUS_TEMPLATE, {}).trim();
}

export interface HighlightShareInput {
	title: string;
	sharing: ArticleSharing;
	campaign: ShareCampaign;
}

export type HighlightShareLinked = "view" | "original" | "none";

export interface HighlightSharePayload {
	text: string;
	title: string | undefined;
	url: string | undefined;
	linked: HighlightShareLinked;
	fragment: boolean;
	targets: readonly ShareTarget[];
	beaconUrl: string;
}

const QUOTE_ONLY_TARGETS: readonly ShareTargetKey[] = ["whatsapp", "x", "email"];

export function highlightSharePayload(input: {
	share: HighlightShareInput;
	passage: string;
	fragment: string | undefined;
	beaconUrl: string;
}): HighlightSharePayload {
	const { share, beaconUrl } = input;
	const sharing = share.sharing;
	const text = t("articleBody.highlightPopover.quote", { quote: input.passage });
	if (sharing.kind === "quote-only") {
		return {
			text,
			title: undefined,
			url: undefined,
			linked: "none",
			fragment: false,
			targets: buildShareTargets({ quote: text, targets: QUOTE_ONLY_TARGETS }),
			beaconUrl,
		};
	}
	const fragment = sharing.kind === "view" ? input.fragment : undefined;
	const linkFor = (medium: ShareTargetKey | "native-share"): string =>
		sharing.kind === "view"
			? `${taggedReaderViewUrl({ readerViewUrl: sharing.url, campaign: share.campaign, source: "highlight-share", medium })}${fragment ?? ""}`
			: sharing.url;
	return {
		text,
		title: share.title,
		url: linkFor("native-share"),
		linked: sharing.kind,
		fragment: fragment !== undefined,
		targets: buildShareTargets({ title: share.title, quote: text, linkFor, targets: ALL_SHARE_TARGETS }),
		beaconUrl,
	};
}

export function renderHighlightPopoverPanel(input: {
	highlightId: HighlightId;
	note: string | undefined;
	quote: string;
	share: HighlightSharePayload | undefined;
}): string {
	const { highlightId, note, quote, share } = input;
	return render(PANEL_TEMPLATE, {
		highlightId,
		note,
		quote,
		share,
		noteLabel:
			note === undefined ? t("articleBody.highlightsRail.addNote") : t("articleBody.highlightsRail.editNote"),
		notePopoverId: highlightNoteEditPopoverId(highlightId),
		deletePopoverId: highlightDeletePopoverId(highlightId),
		noteDeleteTriggerHtml:
			note === undefined ? "" : renderHighlightNoteDeleteTrigger({ highlightId, placement: "panel" }),
	}).trim();
}

export function renderHighlightPopovers(input: {
	views: readonly HighlightsRailRowView[];
	shares: ReadonlyMap<HighlightId, HighlightSharePayload> | undefined;
}): string {
	const panelsHtml = input.views.flatMap(({ highlightId, note, quote, marked, edit }) =>
		marked && edit !== undefined
			? [renderHighlightPopoverPanel({ highlightId, note, quote, share: input.shares?.get(highlightId) })]
			: [],
	);
	return render(TEMPLATE, { panelsHtml, hintHtml: renderHighlightPopoverHint() }).trim();
}
