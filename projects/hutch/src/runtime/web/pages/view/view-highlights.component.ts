import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_HIGHLIGHT_ID_PREFIX, HighlightIdSchema } from "@packages/domain/article";
import { VIEW_HIGHLIGHT_LIMIT, VIEW_HIGHLIGHT_MAX_TEXT_LENGTH } from "@packages/domain/article/highlight";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { CLICK_SURFACES, render, renderConfirmPopover, withClickSurface, withInternalTracking } from "@packages/web-shell";
import {
	renderHighlightPopoverHint,
	renderHighlightPopoverPanel,
} from "../../shared/article-body/highlight-popover/highlight-popover.component";
import {
	type HighlightFormTarget,
	renderHighlightNoteDeleteForm,
	renderHighlightNoteEditDialog,
} from "../../shared/article-body/highlights/highlight-note-dialog.component";
import { renderHighlightPreview } from "../../shared/article-body/highlights/highlight-preview.component";
import {
	highlightDeletePopoverId,
	renderHighlightDeleteConfirm,
} from "../../shared/article-body/highlights-rail/highlights-rail.component";
import {
	HIGHLIGHT_TOOLBAR_SCRIPT,
	renderLocalHighlightToolbar,
} from "../../shared/article-body/highlights/highlight-toolbar.component";
import { VIEW_HIGHLIGHTS_EVENT_PATH, VIEW_HIGHLIGHTS_KEEP_PATH } from "./view-highlights-paths";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const CARD_TEMPLATE = readFileSync(join(__dirname, "view-highlights.template.html"), "utf-8");

const KEEP_FORM_TEMPLATE = readFileSync(join(__dirname, "view-highlights-keep-form.template.html"), "utf-8");

export const VIEW_HIGHLIGHTS_STYLES = readFileSync(join(__dirname, "view-highlights.styles.css"), "utf-8");

export const VIEW_HIGHLIGHTS_POPOVER_ID = "view-highlights-keep";

const INLINE_KEEP_FORM_ID = "view-highlights-keep-inline";

const PLACEHOLDER_ID = HighlightIdSchema.parse("00000000-0000-4000-8000-000000000000");

const LOCAL_TARGET: HighlightFormTarget = { kind: "local" };

function renderTextSurfaces(note: string | undefined): string {
	return [
		note === undefined ? "" : renderHighlightPreview({ highlightId: PLACEHOLDER_ID, note }),
		renderHighlightPopoverPanel({ highlightId: PLACEHOLDER_ID, note }),
		renderHighlightNoteEditDialog({ highlightId: PLACEHOLDER_ID, note, target: LOCAL_TARGET }),
	].join("");
}

function renderConfirm(note: string | undefined): string {
	return renderHighlightDeleteConfirm({ highlightId: PLACEHOLDER_ID, note, target: LOCAL_TARGET });
}

export const VIEW_HIGHLIGHTS_SCRIPTS = `<script src="/client-dist/view-highlights.client.js" defer></script>${HIGHLIGHT_TOOLBAR_SCRIPT}`;

function keepFormAction(): string {
	return withClickSurface(
		withInternalTracking(VIEW_HIGHLIGHTS_KEEP_PATH, { source: "view-highlights", content: "keep" }),
		CLICK_SURFACES.readerPublic,
	);
}

function renderKeepForm(input: { articleUrl: string; placement: "popover" | "inline" }): string {
	return render(KEEP_FORM_TEMPLATE, {
		action: keepFormAction(),
		articleUrl: input.articleUrl,
		inline: input.placement === "inline",
		inlineId: INLINE_KEEP_FORM_ID,
		popoverId: input.placement === "popover" ? VIEW_HIGHLIGHTS_POPOVER_ID : undefined,
		autofocus: input.placement === "popover",
		maxLength: VIEW_HIGHLIGHT_MAX_TEXT_LENGTH.toLocaleString(DEFAULT_LOCALE),
	}).trim();
}

export interface LocalViewHighlights {
	toolbarHtml: string;
	cardHtml: string;
	dialogHtml: string;
}

export function renderLocalViewHighlights(input: { articleUrl: string }): LocalViewHighlights {
	return {
		toolbarHtml: renderLocalHighlightToolbar({ openedUrl: VIEW_HIGHLIGHTS_EVENT_PATH }),
		cardHtml: render(CARD_TEMPLATE, {
			articleUrl: input.articleUrl,
			eventUrl: VIEW_HIGHLIGHTS_EVENT_PATH,
			popoverId: VIEW_HIGHLIGHTS_POPOVER_ID,
			inlineId: INLINE_KEEP_FORM_ID,
			idPrefix: ARTICLE_HIGHLIGHT_ID_PREFIX,
			savePath: "/save",
			signupPath: "/signup",
			loginPath: "/login",
			limit: VIEW_HIGHLIGHT_LIMIT,
			maxLength: VIEW_HIGHLIGHT_MAX_TEXT_LENGTH,
			inlineKeepFormHtml: renderKeepForm({ articleUrl: input.articleUrl, placement: "inline" }),
			placeholderId: PLACEHOLDER_ID,
			deletePopoverId: highlightDeletePopoverId(PLACEHOLDER_ID),
			noteDeleteFormHtml: renderHighlightNoteDeleteForm({ highlightId: PLACEHOLDER_ID, target: LOCAL_TARGET }),
			hintHtml: renderHighlightPopoverHint(),
			textWithNoteHtml: renderTextSurfaces(PLACEHOLDER_ID),
			textHtml: renderTextSurfaces(undefined),
			confirmWithNoteHtml: renderConfirm(PLACEHOLDER_ID),
			confirmHtml: renderConfirm(undefined),
		}).trim(),
		dialogHtml: renderConfirmPopover({
			id: VIEW_HIGHLIGHTS_POPOVER_ID,
			key: "view-highlights-keep",
			title: t("view.highlights.popup.title"),
			body: t("view.highlights.popup.body", { limit: String(VIEW_HIGHLIGHT_LIMIT) }),
			actionsHtml: renderKeepForm({ articleUrl: input.articleUrl, placement: "popover" }),
		}),
	};
}
