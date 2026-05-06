import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "../../../require-env";
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

export interface ShareBalloonInput {
	shareUrl: string;
	shareTitle: string;
	shareHint: string;
}

export function renderShareBalloon(input: ShareBalloonInput): string {
	return render(SHARE_BALLOON_TEMPLATE, {
		shareUrl: input.shareUrl,
		shareTitle: input.shareTitle,
		shareHint: input.shareHint,
		shareIconSvg: SHARE_ICON_SVG,
		copyIconSvg: COPY_ICON_SVG,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
	});
}
