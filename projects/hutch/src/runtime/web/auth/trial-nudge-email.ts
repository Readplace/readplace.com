import type { ReaderArticleHashId } from "@packages/domain/article";
import { EMAIL_CLICK_MEDIUM } from "@packages/web-analytics";
import { ACCOUNT_PLANS_URL } from "../pages/account/account.url";
import { buildOwnerReaderPath } from "../pages/readlist/owner-reader-link";
import { listUnsubscribeHeaders, unsubscribeUrlFor } from "../queue-digest-email";

const TRIAL_NUDGE_CAMPAIGN = "trial-keep";

export const TRIAL_NUDGE_SIGNOFF = "— Fayner Brack, Founder & CEO";

export interface TrialNudgeEmailItem {
	articleId: ReaderArticleHashId;
	title: string;
	siteName: string;
}

export interface TrialNudgeEmail {
	subject: string;
	headers: Record<string, string>;
	to: (mediaType: "text/html" | "text/plain") => string;
}

export function trialNudgeLinks(input: {
	source: "day3-email" | "day7-email";
	unsubscribeKind: "trial-day3" | "trial-day7";
	appOrigin: string;
	unsubscribeToken: string;
}) {
	const tracked = (url: URL, content: string): string => {
		const link = new URL(url);
		link.searchParams.set("utm_source", input.source);
		link.searchParams.set("utm_medium", EMAIL_CLICK_MEDIUM);
		link.searchParams.set("utm_campaign", TRIAL_NUDGE_CAMPAIGN);
		link.searchParams.set("utm_content", content);
		return link.toString();
	};
	const unsubscribeUrl = unsubscribeUrlFor({
		token: input.unsubscribeToken,
		appOrigin: input.appOrigin,
		kind: input.unsubscribeKind,
	});
	return {
		to: (path: string, content: string): string => tracked(new URL(path, input.appOrigin), content),
		article: (articleId: ReaderArticleHashId): string =>
			tracked(new URL(buildOwnerReaderPath(articleId), input.appOrigin), "article"),
		keep: (): string => tracked(new URL(ACCOUNT_PLANS_URL, input.appOrigin), "keep"),
		unsubscribe: (): string => tracked(unsubscribeUrl, "unsubscribe"),
		headers: listUnsubscribeHeaders(unsubscribeUrl),
	};
}
