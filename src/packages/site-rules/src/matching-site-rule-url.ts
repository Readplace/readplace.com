import { equivalentHostUrls } from "@packages/article-resource-unique-id";
import type { SiteRules } from "./site-rules";

function hostnameOf(url: string): string | undefined {
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

export function matchingSiteRuleUrl(params: { site: SiteRules; url: string }): string | undefined {
	return equivalentHostUrls(params.url).find((candidate) => {
		const hostname = hostnameOf(candidate);
		return hostname !== undefined && params.site.matches({ url: candidate, hostname });
	});
}
