import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "@packages/require-env";
import { iconSvg } from "@packages/ui-icons";
import { render, renderConfirmPopover } from "@packages/web-shell";
import { SHARE_TARGET_LOGO_SVG } from "./share-target-logos";

const FOUNDER_AVATAR_URL = `${requireEnv("STATIC_BASE_URL")}/fayner-brack.jpg`;

const DIALOG_TEMPLATE = readFileSync(join(__dirname, "share-dialog.template.html"), "utf-8");
const PANEL_TEMPLATE = readFileSync(join(__dirname, "share-panel.template.html"), "utf-8");

export const SHARE_DIALOG_POPOVER_ID = "reader-share";

export const SHARE_DIALOG_SCRIPT = `<script src="/client-dist/share-dialog.client.js" defer></script>`;

export type ShareCampaign = "reader-internal" | "reader-public";

export interface ShareInput {
	shareUrl: string;
	title: string;
	campaign: ShareCampaign;
}

type ShareTargetKey = "whatsapp" | "facebook" | "x" | "email" | "reddit";

export interface ShareTarget {
	key: ShareTargetKey;
	label: string;
	href: string;
	logoSvg: string;
	circleClass: string;
	opensNewTab: boolean;
}

function taggedShareUrl(input: ShareInput, medium: ShareTargetKey | "copy"): string {
	const url = new URL(input.shareUrl);
	url.searchParams.set("utm_source", "share-dialog");
	url.searchParams.set("utm_medium", medium);
	url.searchParams.set("utm_campaign", input.campaign);
	return url.toString();
}

function buildShareTargets(input: ShareInput): ShareTarget[] {
	const title = encodeURIComponent(input.title);
	const linkFor = (medium: ShareTargetKey): string => encodeURIComponent(taggedShareUrl(input, medium));
	return [
		{
			key: "whatsapp",
			label: "WhatsApp",
			href: `https://wa.me/?text=${encodeURIComponent(`${input.title} ${taggedShareUrl(input, "whatsapp")}`)}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.whatsapp,
			circleClass: "share-dialog__circle--whatsapp",
			opensNewTab: true,
		},
		{
			key: "facebook",
			label: "Facebook",
			href: `https://www.facebook.com/sharer/sharer.php?u=${linkFor("facebook")}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.facebook,
			circleClass: "share-dialog__circle--facebook",
			opensNewTab: true,
		},
		{
			key: "x",
			label: "X",
			href: `https://x.com/intent/post?url=${linkFor("x")}&text=${title}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.x,
			circleClass: "share-dialog__circle--x",
			opensNewTab: true,
		},
		{
			key: "email",
			label: "Email",
			href: `mailto:?subject=${title}&body=${linkFor("email")}`,
			logoSvg: iconSvg("envelope"),
			circleClass: "share-dialog__circle--email",
			opensNewTab: false,
		},
		{
			key: "reddit",
			label: "Reddit",
			href: `https://www.reddit.com/submit?url=${linkFor("reddit")}&title=${title}`,
			logoSvg: SHARE_TARGET_LOGO_SVG.reddit,
			circleClass: "share-dialog__circle--reddit",
			opensNewTab: true,
		},
	];
}

export function renderSharePanel(input: ShareInput): string {
	return render(PANEL_TEMPLATE, {
		copyUrl: taggedShareUrl(input, "copy"),
		targets: buildShareTargets(input),
	});
}

export function renderShareDialog(input: ShareInput): string {
	return renderConfirmPopover({
		id: SHARE_DIALOG_POPOVER_ID,
		key: "share",
		title: "Share",
		lead: "Copy the link to this article or send it to an app.",
		body: "",
		actionsHtml: render(DIALOG_TEMPLATE, {
			popoverId: SHARE_DIALOG_POPOVER_ID,
			founderAvatarUrl: FOUNDER_AVATAR_URL,
			panelHtml: renderSharePanel(input),
		}),
	});
}
