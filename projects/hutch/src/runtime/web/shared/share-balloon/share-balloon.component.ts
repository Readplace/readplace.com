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
	/** First 6 hex chars of the authenticated sharer's UserId. When present,
	 * stamped into utm_content so recipients hit the permanent-share branch
	 * of {@link computePublicViewExpiry} and skip the expiry counter. */
	sharerUserIdPrefix?: string;
}

function withUtm(
	baseUrl: string,
	params: {
		medium: "copy" | "share";
		campaign: ShareBalloonSource;
		content?: string;
	},
): string {
	const url = new URL(baseUrl);
	url.searchParams.set("utm_source", "share-balloon");
	url.searchParams.set("utm_medium", params.medium);
	url.searchParams.set("utm_campaign", params.campaign);
	if (params.content !== undefined) {
		url.searchParams.set("utm_content", params.content);
	}
	return url.toString();
}

export function renderShareBalloon(input: ShareBalloonInput): string {
	return render(SHARE_BALLOON_TEMPLATE, {
		shareUrlCopy: withUtm(input.shareUrl, {
			medium: "copy",
			campaign: input.shareSource,
			content: input.sharerUserIdPrefix,
		}),
		shareUrlShare: withUtm(input.shareUrl, {
			medium: "share",
			campaign: input.shareSource,
			content: input.sharerUserIdPrefix,
		}),
		shareTitle: input.shareTitle,
		shareHint: input.shareHint,
		shareIconSvg: SHARE_ICON_SVG,
		copyIconSvg: COPY_ICON_SVG,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
	});
}
