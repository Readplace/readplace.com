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

export type ShareTargetKey = "whatsapp" | "facebook" | "x" | "email" | "reddit";

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

export function taggedReaderViewUrl(input: {
	readerViewUrl: string;
	campaign: ShareCampaign;
	source: "share-dialog" | "highlight-share";
	medium: ShareTargetKey | "copy" | "native-share";
}): string {
	const { medium } = input;
	const url = new URL(input.readerViewUrl);
	url.searchParams.set("utm_source", input.source);
	url.searchParams.set("utm_medium", medium);
	url.searchParams.set("utm_campaign", input.campaign);
	url.searchParams.set("utm_content", "reader-view");
	return url.toString();
}

export const ALL_SHARE_TARGETS: readonly ShareTargetKey[] = ["whatsapp", "facebook", "x", "email", "reddit"];

function queryOf(params: ReadonlyArray<readonly [string, string | undefined]>): string {
	return params
		.flatMap(([name, value]) => (value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`]))
		.join("&");
}

function joined(parts: ReadonlyArray<string | undefined>, separator: string): string | undefined {
	const present = parts.filter((part): part is string => part !== undefined);
	return present.length === 0 ? undefined : present.join(separator);
}

function shareTargetFor(input: {
	key: ShareTargetKey;
	title: string | undefined;
	quote: string | undefined;
	link: string | undefined;
}): ShareTarget {
	const { key, title, quote, link } = input;
	switch (key) {
		case "whatsapp":
			return {
				key,
				label: "WhatsApp",
				href: `https://wa.me/?${queryOf([["text", joined([quote, joined([title, link], " ")], "\n")]])}`,
				logoSvg: SHARE_TARGET_LOGO_SVG.whatsapp,
				circleClass: "share-dialog__circle--whatsapp",
				opensNewTab: true,
			};
		case "facebook":
			return {
				key,
				label: "Facebook",
				href: `https://www.facebook.com/sharer/sharer.php?${queryOf([["u", link]])}`,
				logoSvg: SHARE_TARGET_LOGO_SVG.facebook,
				circleClass: "share-dialog__circle--facebook",
				opensNewTab: true,
			};
		case "x":
			return {
				key,
				label: "X",
				href: `https://x.com/intent/post?${queryOf([
					["url", link],
					["text", joined([quote, title], "\n")],
				])}`,
				logoSvg: SHARE_TARGET_LOGO_SVG.x,
				circleClass: "share-dialog__circle--x",
				opensNewTab: true,
			};
		case "email":
			return {
				key,
				label: t("reader.share.target.email"),
				href: `mailto:?${queryOf([
					["subject", title],
					["body", joined([quote, link], "\r\n\r\n")],
				])}`,
				logoSvg: iconSvg("envelope"),
				circleClass: "share-dialog__circle--email",
				opensNewTab: false,
			};
		case "reddit":
			return {
				key,
				label: "Reddit",
				href: `https://www.reddit.com/submit?${queryOf([
					["url", link],
					["title", title],
				])}`,
				logoSvg: SHARE_TARGET_LOGO_SVG.reddit,
				circleClass: "share-dialog__circle--reddit",
				opensNewTab: true,
			};
	}
}

export function buildShareTargets(input: {
	title?: string;
	quote?: string;
	linkFor?: (medium: ShareTargetKey) => string;
	targets: readonly ShareTargetKey[];
}): ShareTarget[] {
	const { linkFor } = input;
	return input.targets.map((key) =>
		shareTargetFor({ key, title: input.title, quote: input.quote, link: linkFor === undefined ? undefined : linkFor(key) }),
	);
}

function originalLink(input: ShareInput): ShareLink {
	return {
		key: "original",
		label: t("reader.share.link.original"),
		copyName: t("reader.share.copy.original"),
		copyUrl: input.originalUrl,
		targets: buildShareTargets({ title: input.title, linkFor: () => input.originalUrl, targets: ALL_SHARE_TARGETS }),
	};
}

function shareLinksOf(input: ShareInput): ShareLink[] {
	const readerViewUrl = input.readerViewUrl;
	if (readerViewUrl === undefined) return [originalLink(input)];
	const tagged = (medium: ShareTargetKey | "copy"): string =>
		taggedReaderViewUrl({ readerViewUrl, campaign: input.campaign, source: "share-dialog", medium });
	return [
		{
			key: "reader-view",
			label: t("reader.share.link.readerView"),
			copyName: t("reader.share.copy.readerView"),
			copyUrl: tagged("copy"),
			targets: buildShareTargets({ title: input.title, linkFor: tagged, targets: ALL_SHARE_TARGETS }),
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
