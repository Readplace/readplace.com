import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "@packages/require-env";
import { iconSvg } from "@packages/ui-icons";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render, renderConfirmPopover } from "@packages/web-shell";
import { SHARE_TARGET_LOGO_SVG } from "./share-target-logos";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const FOUNDER_AVATAR_URL = `${requireEnv("STATIC_BASE_URL")}/fayner-brack.jpg`;

const DIALOG_TEMPLATE = readFileSync(join(__dirname, "share-dialog.template.html"), "utf-8");
const PANEL_TEMPLATE = readFileSync(join(__dirname, "share-panel.template.html"), "utf-8");

export const SHARE_DIALOG_POPOVER_ID = "reader-share";

export const SHARE_DIALOG_SCRIPT = `<script src="/client-dist/share-dialog.client.js" defer></script>`;

export type ShareCampaign = "reader-internal" | "reader-public";

export interface ShareInput {
	title: string;
	campaign: ShareCampaign;
	originalUrl: string;
	readerViewUrl: string | undefined;
}

export type SharePanelInstance = "dialog" | "toolbar" | "menu";

type ShareLinkKey = "reader-view" | "original";

type ShareTargetKey = "whatsapp" | "facebook" | "x" | "email" | "reddit";

export interface ShareTarget {
	key: ShareTargetKey;
	label: string;
	href: string;
	logoSvg: string;
	circleClass: string;
	opensNewTab: boolean;
}

interface ShareLink {
	key: ShareLinkKey;
	label: string;
	copyName: string;
	copyUrl: string;
	targets: ShareTarget[];
}

function taggedReaderViewUrl(input: { readerViewUrl: string; campaign: ShareCampaign }, medium: ShareTargetKey | "copy"): string {
	const url = new URL(input.readerViewUrl);
	url.searchParams.set("utm_source", "share-dialog");
	url.searchParams.set("utm_medium", medium);
	url.searchParams.set("utm_campaign", input.campaign);
	url.searchParams.set("utm_content", "reader-view");
	return url.toString();
}

function buildShareTargets(input: { title: string; linkFor: (medium: ShareTargetKey) => string }): ShareTarget[] {
	const title = encodeURIComponent(input.title);
	const encodedLinkFor = (medium: ShareTargetKey): string => encodeURIComponent(input.linkFor(medium));
	return [
		{
			key: "whatsapp",
			label: "WhatsApp",
			href: `https://wa.me/?text=${encodeURIComponent(`${input.title} ${input.linkFor("whatsapp")}`)}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.whatsapp,
			circleClass: "share-dialog__circle--whatsapp",
			opensNewTab: true,
		},
		{
			key: "facebook",
			label: "Facebook",
			href: `https://www.facebook.com/sharer/sharer.php?u=${encodedLinkFor("facebook")}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.facebook,
			circleClass: "share-dialog__circle--facebook",
			opensNewTab: true,
		},
		{
			key: "x",
			label: "X",
			href: `https://x.com/intent/post?url=${encodedLinkFor("x")}&text=${title}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.x,
			circleClass: "share-dialog__circle--x",
			opensNewTab: true,
		},
		{
			key: "email",
			label: "Email",
			href: `mailto:?subject=${title}&body=${encodedLinkFor("email")}`,
			logoSvg: iconSvg("envelope"),
			circleClass: "share-dialog__circle--email",
			opensNewTab: false,
		},
		{
			key: "reddit",
			label: "Reddit",
			href: `https://www.reddit.com/submit?url=${encodedLinkFor("reddit")}&title=${title}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.reddit,
			circleClass: "share-dialog__circle--reddit",
			opensNewTab: true,
		},
	];
}

function originalLink(input: ShareInput): ShareLink {
	return {
		key: "original",
		label: t("reader.share.link.original"),
		copyName: t("reader.share.copy.original"),
		copyUrl: input.originalUrl,
		targets: buildShareTargets({ title: input.title, linkFor: () => input.originalUrl }),
	};
}

function shareLinksOf(input: ShareInput): ShareLink[] {
	const readerViewUrl = input.readerViewUrl;
	if (readerViewUrl === undefined) return [originalLink(input)];
	const tagged = (medium: ShareTargetKey | "copy"): string =>
		taggedReaderViewUrl({ readerViewUrl, campaign: input.campaign }, medium);
	return [
		{
			key: "reader-view",
			label: t("reader.share.link.readerView"),
			copyName: t("reader.share.copy.readerView"),
			copyUrl: tagged("copy"),
			targets: buildShareTargets({ title: input.title, linkFor: tagged }),
		},
		originalLink(input),
	];
}

function renderPanel(input: ShareInput, placement: { instance: SharePanelInstance; oob: boolean }): string {
	const links = shareLinksOf(input);
	return render(PANEL_TEMPLATE, {
		instance: placement.instance,
		oob: placement.oob,
		choice: links.length > 1,
		links,
	});
}

export function renderSharePanel(input: ShareInput, instance: SharePanelInstance): string {
	return renderPanel(input, { instance, oob: false });
}

export function renderShareFallbacks(input: ShareInput): { toolbar: string; menu: string } {
	return { toolbar: renderSharePanel(input, "toolbar"), menu: renderSharePanel(input, "menu") };
}

export function renderSharePanelsOob(input: ShareInput, instances: readonly SharePanelInstance[]): string {
	return instances.map((instance) => renderPanel(input, { instance, oob: true })).join("");
}

export function renderShareDialog(input: ShareInput): string {
	return renderConfirmPopover({
		id: SHARE_DIALOG_POPOVER_ID,
		key: "share",
		title: "Share",
		lead: t("reader.share.lead"),
		body: "",
		actionsHtml: render(DIALOG_TEMPLATE, {
			popoverId: SHARE_DIALOG_POPOVER_ID,
			founderAvatarUrl: FOUNDER_AVATAR_URL,
			panelHtml: renderSharePanel(input, "dialog"),
		}),
	});
}
