const COMMENT_VIEW_PATH = /^(\/p\/[^/]+)\/comments\/?$/;
const EMAIL_COMMENT_BUTTON_CAMPAIGN = "email-half-magic-comments";

export function toSubstackPostUrl(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	const post = COMMENT_VIEW_PATH.exec(parsed.pathname);
	if (post === null) return url;
	const params = parsed.searchParams;
	if (params.get("action") === "post-comment" && params.get("comments") === "true") {
		params.delete("action");
		params.delete("comments");
	} else if (params.get("utm_campaign") === EMAIL_COMMENT_BUTTON_CAMPAIGN) {
		params.delete("utm_campaign");
	} else {
		return url;
	}
	parsed.pathname = post[1];
	return parsed.href;
}
