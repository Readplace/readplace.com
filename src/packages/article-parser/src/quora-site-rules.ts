import { noExtract, noRecovery, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

const TITLE_AND_DESCRIPTION_METAS = ["og:title", "twitter:title", "og:description", "twitter:description"]
	.flatMap((name) => [`meta[property="${name}"]`, `meta[name="${name}"]`])
	.join(", ");
const LONE_HTTP_URL = /^https?:\/\/\S+$/i;

export const quoraSiteRules = {
	matches: ({ hostname }) => hostname === "quora.com" || hostname.endsWith(".quora.com"),
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		for (const meta of document.querySelectorAll(TITLE_AND_DESCRIPTION_METAS)) {
			if (LONE_HTTP_URL.test(String(meta.getAttribute("content")).trim())) meta.remove();
		}
	},
} satisfies SiteRules;
