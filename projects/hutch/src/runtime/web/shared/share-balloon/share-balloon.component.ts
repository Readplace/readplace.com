import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "../../../domain/require-env";
import { render } from "../../render";
import { COPY_ICON_SVG } from "./copy-icon";
import { SHARE_ICON_SVG } from "./share-icon";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const FOUNDER_AVATAR_URL = `${STATIC_BASE_URL}/fayner-brack.jpg`;

const SHARE_BALLOON_TEMPLATE = readFileSync(
	join(__dirname, "share-balloon.template.html"),
	"utf-8",
);

export const SHARE_BALLOON_SCRIPT = `<script src="/client-dist/share-balloon.client.js" defer></script>`;

export type ShareBalloonSource = "reader-internal" | "reader-public";

export interface ShareBalloonInput {
	shareUrl: string;
	shareTitle: string;
	shareHint: string;
	shareSource: ShareBalloonSource;
	/**
	 * When false, the client skips the scroll-to-open listener so the chat
	 * balloon stays closed. Used by reader/view pages while the article is
	 * still loading or has errored, so we don't ask the user to share a
	 * page that hasn't rendered yet.
	 */
	autoOpen: boolean;
}

function withUtm(
	baseUrl: string,
	params: { medium: "copy" | "share"; campaign: ShareBalloonSource },
): string {
	const url = new URL(baseUrl);
	url.searchParams.set("utm_source", "share-balloon");
	url.searchParams.set("utm_medium", params.medium);
	url.searchParams.set("utm_campaign", params.campaign);
	return url.toString();
}

export function renderShareBalloon(input: ShareBalloonInput): string {
	return render(SHARE_BALLOON_TEMPLATE, {
		shareUrlCopy: withUtm(input.shareUrl, {
			medium: "copy",
			campaign: input.shareSource,
		}),
		shareUrlShare: withUtm(input.shareUrl, {
			medium: "share",
			campaign: input.shareSource,
		}),
		shareTitle: input.shareTitle,
		shareHint: input.shareHint,
		shareIconSvg: SHARE_ICON_SVG,
		copyIconSvg: COPY_ICON_SVG,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		autoOpen: input.autoOpen ? "true" : "false",
	});
}
