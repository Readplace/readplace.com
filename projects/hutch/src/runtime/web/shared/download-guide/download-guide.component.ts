import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover } from "@packages/web-shell";
import type { EpubDownloadGuide } from "../epub/epub-download-guide";

const DIALOG_TEMPLATE = readFileSync(join(__dirname, "download-guide.template.html"), "utf-8");
const PANEL_TEMPLATE = readFileSync(join(__dirname, "download-guide-panel.template.html"), "utf-8");
const FALLBACK_TEMPLATE = readFileSync(join(__dirname, "download-guide-fallback.template.html"), "utf-8");

export const DOWNLOAD_GUIDE_POPOVER_ID = "reader-download-guide";

function renderDownloadGuidePanel(guide: EpubDownloadGuide): string {
	return render(PANEL_TEMPLATE, { readerApp: guide.readerApp, learnMoreHref: guide.learnMoreHref });
}

export function renderDownloadGuideFallback(guide: EpubDownloadGuide): string {
	return render(FALLBACK_TEMPLATE, { downloadHref: guide.downloadHref, panelHtml: renderDownloadGuidePanel(guide) });
}

export function renderDownloadGuideDialog(guide: EpubDownloadGuide): string {
	return renderConfirmPopover({
		id: DOWNLOAD_GUIDE_POPOVER_ID,
		key: "download-guide",
		title: guide.title,
		body: guide.body,
		actionsHtml: render(DIALOG_TEMPLATE, {
			popoverId: DOWNLOAD_GUIDE_POPOVER_ID,
			downloadHref: guide.downloadHref,
			panelHtml: renderDownloadGuidePanel(guide),
		}),
	});
}
